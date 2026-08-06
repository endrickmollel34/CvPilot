import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { type Repository, MoreThanOrEqual } from 'typeorm';

import type { Plan, PaymentProviderType } from '@cvpilot/shared';
import { PLAN_LIMITS } from '@cvpilot/shared';

import { SubscriptionEntity } from '../../entities/subscription.entity';
import { PaymentEntity } from '../../entities/payment.entity';
import { AnalysisEntity } from '../../entities/analysis.entity';
import type { UserService } from '../user/user.service';
import type { StripePaymentProvider } from './providers/stripe.provider';
import type { PaymentProvider, InternalBillingEvent } from './providers/payment-provider.interface';

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);
  private readonly providers = new Map<PaymentProviderType, PaymentProvider>();

  constructor(
    @InjectRepository(SubscriptionEntity)
    private readonly subscriptionRepo: Repository<SubscriptionEntity>,
    @InjectRepository(PaymentEntity)
    private readonly paymentRepo: Repository<PaymentEntity>,
    @InjectRepository(AnalysisEntity)
    private readonly analysisRepo: Repository<AnalysisEntity>,
    private readonly userService: UserService,
    stripeProvider: StripePaymentProvider,
  ) {
    this.providers.set('STRIPE', stripeProvider);
  }

  async createCheckoutSession(
    clerkId: string,
    plan: Exclude<Plan, 'free'>,
    providerType: PaymentProviderType = 'STRIPE',
  ): Promise<{ url: string | null }> {
    const provider = this.getProvider(providerType);
    const user = await this.userService.findByClerkId(clerkId);
    const sub = await this.subscriptionRepo.findOneBy({ userId: user.id });

    return provider.createCheckoutSession({
      userId: user.id,
      providerCustomerId: sub?.providerCustomerId,
      plan,
      currency: 'GBP',
      successUrl: `${process.env['FRONTEND_URL'] ?? ''}/dashboard?checkout=success`,
      cancelUrl: `${process.env['FRONTEND_URL'] ?? ''}/dashboard?checkout=cancelled`,
    });
  }

  async createPortalSession(
    clerkId: string,
    providerType: PaymentProviderType = 'STRIPE',
  ): Promise<{ url: string }> {
    const provider = this.getProvider(providerType);
    if (!provider.createCustomerPortalSession) {
      throw new BadRequestException(`Provider ${providerType} does not support a customer portal`);
    }

    const user = await this.userService.findByClerkId(clerkId);
    const sub = await this.subscriptionRepo.findOneBy({ userId: user.id });
    if (!sub?.providerCustomerId) {
      throw new NotFoundException('No active subscription found');
    }

    return provider.createCustomerPortalSession({
      providerCustomerId: sub.providerCustomerId,
      returnUrl: `${process.env['FRONTEND_URL'] ?? ''}/dashboard`,
    });
  }

  async getSubscription(clerkId: string): Promise<SubscriptionEntity | null> {
    const user = await this.userService.findByClerkId(clerkId);
    return this.subscriptionRepo.findOneBy({ userId: user.id });
  }

  async getUserPlan(userId: string): Promise<Plan> {
    const sub = await this.subscriptionRepo.findOneBy({ userId });
    return sub?.plan ?? 'free';
  }

  async canPerformAction(userId: string, action: 'analyse' | 'cover-letter'): Promise<boolean> {
    const plan = await this.getUserPlan(userId);
    const limit =
      action === 'analyse'
        ? PLAN_LIMITS[plan].analysesPerMonth
        : PLAN_LIMITS[plan].coverLettersPerMonth;

    if (limit === Infinity) return true;

    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const count = await this.analysisRepo.count({
      where: { userId, createdAt: MoreThanOrEqual(startOfMonth) },
    });

    return count < limit;
  }

  async handleWebhook(
    providerType: PaymentProviderType,
    rawBody: Buffer,
    signature: string,
  ): Promise<void> {
    const provider = this.getProvider(providerType);
    const event = provider.verifyAndParseWebhook({ rawBody, signature });
    if (!event) return;
    await this.applyBillingEvent(event);
  }

  private getProvider(type: PaymentProviderType): PaymentProvider {
    const provider = this.providers.get(type);
    if (!provider) throw new BadRequestException(`Unknown payment provider: ${type}`);
    return provider;
  }

  private async applyBillingEvent(event: InternalBillingEvent): Promise<void> {
    this.logger.log(`Billing event: ${event.type} from ${event.provider}`);
    switch (event.type) {
      case 'subscription.activated':
        await this.onSubscriptionActivated(event);
        break;
      case 'subscription.updated':
        await this.onSubscriptionUpdated(event);
        break;
      case 'subscription.cancelled':
        await this.onSubscriptionCancelled(event);
        break;
      case 'payment.succeeded':
        await this.onPaymentSucceeded(event);
        break;
      case 'payment.failed':
        await this.onPaymentFailed(event);
        break;
    }
  }

  private async onSubscriptionActivated(event: InternalBillingEvent): Promise<void> {
    const userId = event.metadata?.['internalUserId'] as string | undefined;
    if (!userId || !event.providerCustomerId) {
      this.logger.warn('subscription.activated missing userId or providerCustomerId', event);
      return;
    }

    await this.subscriptionRepo.upsert(
      {
        userId,
        provider: event.provider,
        providerCustomerId: event.providerCustomerId,
        providerSubscriptionId: event.providerSubscriptionId,
        plan: event.plan ?? 'free',
        status: event.subscriptionStatus ?? 'active',
        paymentMethod: event.paymentMethod,
        billingCycle: 'recurring',
      },
      { conflictPaths: ['userId'] },
    );
  }

  private async onSubscriptionUpdated(event: InternalBillingEvent): Promise<void> {
    if (!event.providerCustomerId) return;

    await this.subscriptionRepo.update(
      { providerCustomerId: event.providerCustomerId },
      {
        ...(event.plan && { plan: event.plan }),
        ...(event.subscriptionStatus && { status: event.subscriptionStatus }),
        ...(event.currentPeriodStart && { currentPeriodStart: event.currentPeriodStart }),
        ...(event.currentPeriodEnd && { currentPeriodEnd: event.currentPeriodEnd }),
        ...(event.cancelAtPeriodEnd !== undefined && {
          cancelAtPeriodEnd: event.cancelAtPeriodEnd,
        }),
      },
    );
  }

  private async onSubscriptionCancelled(event: InternalBillingEvent): Promise<void> {
    if (!event.providerCustomerId) return;

    await this.subscriptionRepo.update(
      { providerCustomerId: event.providerCustomerId },
      { status: 'cancelled', plan: 'free', cancelAtPeriodEnd: false },
    );
  }

  private async onPaymentSucceeded(event: InternalBillingEvent): Promise<void> {
    if (!event.providerPaymentId || !event.providerCustomerId) return;

    const sub = await this.subscriptionRepo.findOneBy({
      providerCustomerId: event.providerCustomerId,
    });
    if (!sub) {
      this.logger.warn(`No subscription found for provider customer ${event.providerCustomerId}`);
      return;
    }

    await this.paymentRepo.upsert(
      {
        userId: sub.userId,
        provider: event.provider,
        providerPaymentId: event.providerPaymentId,
        providerTransactionReference: event.providerTransactionReference,
        paymentMethod: event.paymentMethod,
        amount: event.amountMinorUnits ?? 0,
        currency: event.currency ?? 'GBP',
        status: 'succeeded',
      },
      { conflictPaths: ['providerPaymentId'] },
    );
  }

  private async onPaymentFailed(event: InternalBillingEvent): Promise<void> {
    if (!event.providerCustomerId) return;

    await this.subscriptionRepo.update(
      { providerCustomerId: event.providerCustomerId },
      { status: 'past_due' },
    );

    this.logger.warn(`Payment failed for provider customer ${event.providerCustomerId}`);
    // TODO: send renewal prompt via NotificationService
  }
}
