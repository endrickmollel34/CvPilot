import { Injectable, BadRequestException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';

import type { Plan, SubscriptionStatus, Currency } from '@cvpilot/shared';
import type {
  PaymentProvider,
  CheckoutSessionParams,
  CustomerPortalParams,
  WebhookParams,
  InternalBillingEvent,
} from './payment-provider.interface';

@Injectable()
export class StripePaymentProvider implements PaymentProvider {
  readonly providerType = 'STRIPE' as const;

  private readonly stripe: Stripe;
  private readonly planToPriceId: Record<Exclude<Plan, 'free'>, string>;

  constructor(private readonly config: ConfigService) {
    this.stripe = new Stripe(config.getOrThrow<string>('STRIPE_SECRET_KEY'));
    this.planToPriceId = {
      pro: config.getOrThrow<string>('STRIPE_PRICE_PRO_MONTHLY'),
      student: config.getOrThrow<string>('STRIPE_PRICE_STUDENT_MONTHLY'),
    };
  }

  async createCheckoutSession(params: CheckoutSessionParams): Promise<{ url: string | null }> {
    const sessionParams: Stripe.Checkout.SessionCreateParams = {
      mode: 'subscription',
      line_items: [{ price: this.planToPriceId[params.plan], quantity: 1 }],
      success_url: params.successUrl,
      cancel_url: params.cancelUrl,
      metadata: { internalUserId: params.userId, plan: params.plan },
    };

    if (params.providerCustomerId) {
      sessionParams.customer = params.providerCustomerId;
    }

    const session = await this.stripe.checkout.sessions.create(sessionParams);
    return { url: session.url };
  }

  async createCustomerPortalSession(params: CustomerPortalParams): Promise<{ url: string }> {
    const session = await this.stripe.billingPortal.sessions.create({
      customer: params.providerCustomerId,
      return_url: params.returnUrl,
    });
    return { url: session.url };
  }

  verifyAndParseWebhook(params: WebhookParams): InternalBillingEvent | null {
    let event: Stripe.Event;
    try {
      event = this.stripe.webhooks.constructEvent(
        params.rawBody,
        params.signature,
        this.config.getOrThrow<string>('STRIPE_WEBHOOK_SECRET'),
      );
    } catch {
      throw new BadRequestException('Invalid Stripe webhook signature');
    }
    return this.mapStripeEvent(event);
  }

  async cancelSubscription(providerSubscriptionId: string): Promise<void> {
    await this.stripe.subscriptions.cancel(providerSubscriptionId);
  }

  private mapStripeEvent(event: Stripe.Event): InternalBillingEvent | null {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.mode !== 'subscription') return null;
        const plan = (session.metadata?.['plan'] ?? 'free') as Plan;
        return {
          type: 'subscription.activated',
          provider: 'STRIPE',
          providerCustomerId: session.customer as string,
          providerSubscriptionId: session.subscription as string,
          plan,
          subscriptionStatus: 'active',
          paymentMethod: 'CARD',
          currency: (session.currency?.toUpperCase() as Currency) ?? 'GBP',
          metadata: {
            internalUserId: session.metadata?.['internalUserId'],
            sessionId: session.id,
          },
        };
      }

      case 'customer.subscription.updated': {
        const sub = event.data.object as Stripe.Subscription;
        return {
          type: 'subscription.updated',
          provider: 'STRIPE',
          providerCustomerId: sub.customer as string,
          providerSubscriptionId: sub.id,
          plan: this.resolvePlanFromSubscription(sub),
          subscriptionStatus: this.mapStripeStatus(sub.status),
          currentPeriodStart: new Date(sub.current_period_start * 1000),
          currentPeriodEnd: new Date(sub.current_period_end * 1000),
          cancelAtPeriodEnd: sub.cancel_at_period_end,
        };
      }

      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription;
        return {
          type: 'subscription.cancelled',
          provider: 'STRIPE',
          providerCustomerId: sub.customer as string,
          providerSubscriptionId: sub.id,
          subscriptionStatus: 'cancelled',
        };
      }

      case 'invoice.payment_succeeded': {
        const invoice = event.data.object as Stripe.Invoice;
        return {
          type: 'payment.succeeded',
          provider: 'STRIPE',
          providerCustomerId: invoice.customer as string,
          providerSubscriptionId: invoice.subscription as string | undefined,
          providerPaymentId: invoice.payment_intent as string,
          paymentStatus: 'succeeded',
          paymentMethod: 'CARD',
          amountMinorUnits: invoice.amount_paid,
          currency: (invoice.currency?.toUpperCase() as Currency) ?? 'GBP',
        };
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice;
        return {
          type: 'payment.failed',
          provider: 'STRIPE',
          providerCustomerId: invoice.customer as string,
          providerSubscriptionId: invoice.subscription as string | undefined,
          paymentStatus: 'failed',
        };
      }

      default:
        return null;
    }
  }

  private resolvePlanFromSubscription(sub: Stripe.Subscription): Plan {
    const priceId = sub.items.data[0]?.price.id;
    for (const [plan, id] of Object.entries(this.planToPriceId) as [
      Exclude<Plan, 'free'>,
      string,
    ][]) {
      if (id === priceId) return plan;
    }
    return 'free';
  }

  private mapStripeStatus(status: Stripe.Subscription.Status): SubscriptionStatus {
    switch (status) {
      case 'active':
        return 'active';
      case 'past_due':
        return 'past_due';
      case 'canceled':
        return 'cancelled';
      case 'trialing':
        return 'trialing';
      default:
        return 'incomplete';
    }
  }
}
