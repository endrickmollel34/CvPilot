import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { type Repository } from 'typeorm';
import Stripe from 'stripe';
import type { Plan } from '@cvpilot/shared';

import { SubscriptionEntity } from '../../entities/subscription.entity';
import { PaymentEntity } from '../../entities/payment.entity';

const PRICE_IDS: Record<'pro' | 'student', string> = {
  pro: 'price_pro_monthly', // replace with real Stripe price IDs
  student: 'price_student_monthly',
};

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);
  private readonly stripe: Stripe;

  constructor(
    private readonly config: ConfigService,
    @InjectRepository(SubscriptionEntity)
    private readonly subscriptionRepo: Repository<SubscriptionEntity>,
    @InjectRepository(PaymentEntity)
    private readonly paymentRepo: Repository<PaymentEntity>,
  ) {
    this.stripe = new Stripe(this.config.getOrThrow<string>('STRIPE_SECRET_KEY'));
  }

  async createCheckoutSession(_clerkId: string, plan: 'pro' | 'student') {
    // TODO: resolve clerkId → userId, get or create Stripe customer
    const session = await this.stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: PRICE_IDS[plan], quantity: 1 }],
      success_url: `${this.config.getOrThrow('FRONTEND_URL')}/dashboard?checkout=success`,
      cancel_url: `${this.config.getOrThrow('FRONTEND_URL')}/dashboard?checkout=cancelled`,
    });
    return { url: session.url };
  }

  async createPortalSession(_clerkId: string) {
    // TODO: resolve clerkId → stripeCustomerId
    const session = await this.stripe.billingPortal.sessions.create({
      customer: 'TODO',
      return_url: `${this.config.getOrThrow('FRONTEND_URL')}/dashboard`,
    });
    return { url: session.url };
  }

  async getSubscription(_clerkId: string) {
    // TODO: resolve clerkId → userId
    return this.subscriptionRepo.findOneBy({});
  }

  async getUserPlan(userId: string): Promise<Plan> {
    const sub = await this.subscriptionRepo.findOneBy({ userId });
    return (sub?.plan ?? 'free') as Plan;
  }

  async canPerformAction(_userId: string, _action: 'analyse' | 'cover-letter'): Promise<boolean> {
    // TODO: count usage this month, compare against PLAN_LIMITS
    return true;
  }

  async handleStripeWebhook(signature: string, rawBody: Buffer): Promise<void> {
    let event: Stripe.Event;

    try {
      event = this.stripe.webhooks.constructEvent(
        rawBody,
        signature,
        this.config.getOrThrow<string>('STRIPE_WEBHOOK_SECRET'),
      );
    } catch {
      throw new BadRequestException('Invalid Stripe webhook signature');
    }

    this.logger.log(`Stripe event: ${event.type}`);

    switch (event.type) {
      case 'checkout.session.completed':
        await this.onCheckoutCompleted(event.data.object as Stripe.Checkout.Session);
        break;
      case 'customer.subscription.updated':
        await this.onSubscriptionUpdated(event.data.object as Stripe.Subscription);
        break;
      case 'customer.subscription.deleted':
        await this.onSubscriptionDeleted(event.data.object as Stripe.Subscription);
        break;
      case 'invoice.payment_failed':
        await this.onPaymentFailed(event.data.object as Stripe.Invoice);
        break;
      default:
        this.logger.log(`Unhandled Stripe event: ${event.type}`);
    }
  }

  private async onCheckoutCompleted(session: Stripe.Checkout.Session): Promise<void> {
    // TODO: upsert SubscriptionEntity from session data
    this.logger.log('Checkout completed', { sessionId: session.id });
  }

  private async onSubscriptionUpdated(subscription: Stripe.Subscription): Promise<void> {
    // TODO: update SubscriptionEntity status/plan
    this.logger.log('Subscription updated', { subscriptionId: subscription.id });
  }

  private async onSubscriptionDeleted(subscription: Stripe.Subscription): Promise<void> {
    // TODO: set SubscriptionEntity status to 'canceled'
    this.logger.log('Subscription deleted', { subscriptionId: subscription.id });
  }

  private async onPaymentFailed(invoice: Stripe.Invoice): Promise<void> {
    // TODO: set SubscriptionEntity status to 'past_due', send email via NotificationService
    this.logger.log('Payment failed', { invoiceId: invoice.id });
  }
}
