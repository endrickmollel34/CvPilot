import {
  Injectable,
  BadRequestException,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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

  private readonly logger = new Logger(StripePaymentProvider.name);
  private readonly stripe: Stripe;
  private readonly planToPriceId: Record<Exclude<Plan, 'free'>, string>;
  private readonly stripeConfigured: boolean;

  constructor(private readonly config: ConfigService) {
    const secretKey = this.config.getOrThrow<string>('STRIPE_SECRET_KEY');
    const webhookSecret = this.config.getOrThrow<string>('STRIPE_WEBHOOK_SECRET');
    const proPriceId = this.config.getOrThrow<string>('STRIPE_PRICE_PRO_MONTHLY');
    const studentPriceId = this.config.getOrThrow<string>('STRIPE_PRICE_STUDENT_MONTHLY');

    this.stripeConfigured = ![secretKey, webhookSecret, proPriceId, studentPriceId].some((v) =>
      v.includes('placeholder'),
    );
    if (!this.stripeConfigured) {
      this.logger.warn(
        'STRIPE_* env vars are placeholders — billing requests will be rejected with a clear ' +
          'error until real Stripe test-mode credentials are configured in apps/api/.env.',
      );
    }

    this.stripe = new Stripe(secretKey);
    this.planToPriceId = { pro: proPriceId, student: studentPriceId };
  }

  async createCheckoutSession(params: CheckoutSessionParams): Promise<{ url: string | null }> {
    this.ensureConfigured();

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
    this.ensureConfigured();

    const session = await this.stripe.billingPortal.sessions.create({
      customer: params.providerCustomerId,
      return_url: params.returnUrl,
    });
    return { url: session.url };
  }

  async verifyAndParseWebhook(params: WebhookParams): Promise<InternalBillingEvent | null> {
    this.ensureConfigured();

    let event: Stripe.Event;
    try {
      event = this.stripe.webhooks.constructEvent(
        params.rawBody,
        params.signature,
        this.config.getOrThrow<string>('STRIPE_WEBHOOK_SECRET'),
      );
    } catch (err) {
      // Stripe's own SDK error messages are generic diagnostic phrases (e.g.
      // "No signatures found matching...", "Timestamp outside the tolerance
      // zone") — safe to log. Never log params.rawBody, params.signature, or
      // the webhook secret itself; this is the only context needed to tell
      // a wrong/rotated STRIPE_WEBHOOK_SECRET apart from clock skew.
      this.logger.warn(
        `Stripe webhook signature verification failed: ${err instanceof Error ? err.message : 'unknown error'}`,
      );
      throw new BadRequestException('Invalid Stripe webhook signature');
    }
    return this.mapStripeEvent(event);
  }

  async cancelSubscription(providerSubscriptionId: string): Promise<void> {
    this.ensureConfigured();
    await this.stripe.subscriptions.cancel(providerSubscriptionId);
  }

  private ensureConfigured(): void {
    if (!this.stripeConfigured) {
      throw new ServiceUnavailableException(
        'Payments are not configured for this environment. Set real STRIPE_* test-mode ' +
          'values in apps/api/.env to enable checkout.',
      );
    }
  }

  private async mapStripeEvent(event: Stripe.Event): Promise<InternalBillingEvent | null> {
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
        // Stripe explicitly does NOT guarantee webhook delivery order, and
        // explicitly warns against using event.created to reconcile order —
        // "Snapshot events record created in seconds, so distinct events can
        // share a timestamp" (docs.stripe.com/webhooks#event-ordering). A
        // production incident proved this isn't theoretical: cancelling via
        // the Customer Portal produced two customer.subscription.updated
        // deliveries ~1 second apart, and the one carrying the STALE
        // cancel_at_period_end: false snapshot was processed after the one
        // carrying the correct cancel_at_period_end: true — so a plain
        // last-write-wins persist of whichever event's embedded payload
        // arrives last silently reverted the user's cancellation in our DB
        // while Stripe's own records (and the Customer Portal) stayed
        // correct throughout.
        //
        // Fix: never trust the payload embedded in this event for what to
        // persist. Re-fetch the subscription's current live state from
        // Stripe's API — the id is the one piece of the embedded payload
        // that's safe to trust (it's an immutable identifier, not mutable
        // state) — and derive every field from that live object instead.
        // This makes processing order-independent: whichever of two
        // out-of-order deliveries for the same subscription is processed
        // last, both re-fetch the same live state and persist the same
        // (correct, current) result.
        const eventSub = event.data.object as Stripe.Subscription;
        const sub = await this.stripe.subscriptions.retrieve(eventSub.id);

        const periodEndSeconds = this.resolveCurrentPeriodEndSeconds(sub);
        const cancelAtPeriodEnd = this.resolveCancelAtPeriodEnd(sub, periodEndSeconds);

        this.logger.log(
          `customer.subscription.updated (event ${event.id}, sub ...${eventSub.id.slice(-8)}): ` +
            `embedded cancel_at_period_end=${eventSub.cancel_at_period_end}, ` +
            `live cancel_at_period_end=${sub.cancel_at_period_end}, cancel_at=${sub.cancel_at ?? 'null'}, ` +
            `resolved period end=${periodEndSeconds ?? 'unknown'}, derived cancelAtPeriodEnd=${cancelAtPeriodEnd}` +
            (eventSub.cancel_at_period_end !== sub.cancel_at_period_end
              ? ' — MISMATCH, embedded payload was stale, using live value'
              : ''),
        );

        // Since API version 2025-03-31.basil, Stripe moved the billing period
        // off the Subscription object entirely — current_period_start/end now
        // live per subscription item (docs.stripe.com/changelog/basil/2025-03-31/
        // deprecate-subscription-current-period-start-and-end). CVPilot only ever
        // sells single-price subscriptions, so the first item's period is the
        // subscription's period. resolveCurrentPeriodEndSeconds() above is the
        // single source of truth for this — reused below rather than reading
        // sub.items.data[0] a second time, so the period-end value compared
        // against cancel_at is guaranteed to be the exact same one reported
        // as currentPeriodEnd.
        const periodStartSeconds = sub.items.data[0]?.current_period_start;
        return {
          type: 'subscription.updated',
          provider: 'STRIPE',
          providerCustomerId: sub.customer as string,
          providerSubscriptionId: sub.id,
          plan: this.resolvePlanFromSubscription(sub),
          subscriptionStatus: this.mapStripeStatus(sub.status),
          ...(periodStartSeconds !== undefined &&
            periodEndSeconds !== undefined && {
              currentPeriodStart: new Date(periodStartSeconds * 1000),
              currentPeriodEnd: new Date(periodEndSeconds * 1000),
            }),
          cancelAtPeriodEnd,
          ...(sub.cancel_at != null && { cancelAt: new Date(sub.cancel_at * 1000) }),
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
          providerSubscriptionId: this.resolveSubscriptionIdFromInvoice(invoice),
          // Since basil, Invoice.payment_intent no longer exists (an invoice can
          // now settle via multiple partial payments — see Invoice.payments,
          // which requires an expand we don't request on webhook payloads). The
          // Invoice id itself is always present and unique per billing-cycle
          // charge, so it's the stable idempotency key here instead.
          providerPaymentId: invoice.id,
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
          providerSubscriptionId: this.resolveSubscriptionIdFromInvoice(invoice),
          paymentStatus: 'failed',
        };
      }

      default:
        return null;
    }
  }

  // Since basil, Invoice.subscription no longer exists — the generating
  // subscription now lives at invoice.parent.subscription_details.subscription,
  // gated behind invoice.parent.type (docs.stripe.com/changelog/basil/
  // 2025-03-31/adds-new-parent-field-to-invoicing-objects). A manually-created
  // invoice (parent.type === 'quote_details', or no parent at all) has none.
  private resolveSubscriptionIdFromInvoice(invoice: Stripe.Invoice): string | undefined {
    if (invoice.parent?.type !== 'subscription_details') return undefined;
    const subscription = invoice.parent.subscription_details?.subscription;
    return typeof subscription === 'string' ? subscription : subscription?.id;
  }

  // Since basil, current_period_start/end live per subscription item, not on
  // the Subscription object itself (see the customer.subscription.updated
  // case above). CVPilot only ever sells single-price subscriptions, so the
  // first item's period end is THE subscription's period end. Single source
  // of truth, reused both for the currentPeriodEnd field and for the
  // cancel_at-equals-period-end comparison in resolveCancelAtPeriodEnd —
  // duplicating this lookup would risk the two ever going out of sync.
  private resolveCurrentPeriodEndSeconds(sub: Stripe.Subscription): number | undefined {
    return sub.items.data[0]?.current_period_end;
  }

  // Internal meaning: "this subscription is scheduled to lose paid access at
  // the current billing period's end" — deliberately NOT a direct mirror of
  // Stripe's own cancel_at_period_end boolean. See InternalBillingEvent's
  // cancelAtPeriodEnd docstring for the full rationale; summary of the
  // production evidence that proved the direct-mirror assumption wrong
  // (2026-09-03 incident, a real webhook payload for a subscription the
  // Stripe Dashboard displayed as "Cancels Oct 3, 2026"):
  //   status: "active", cancel_at_period_end: false,
  //   cancel_at: 1791043725, canceled_at: 1788457549,
  //   cancellation_details.reason: "cancellation_requested",
  //   items.data[0].current_period_end: 1791043725
  // cancel_at exactly equals the period end here — under CVPilot's current
  // Stripe API version/billing mode, the Customer Portal's "cancel at
  // period end" flow apparently sets cancel_at to a timestamp rather than
  // setting the classic cancel_at_period_end=true boolean.
  //
  // Deliberately NOT using canceled_at for this at all: canceled_at is
  // populated the moment cancellation is *requested*, not when access
  // actually ends — the exact production payload above has canceled_at set
  // while status is still "active" and the subscription is still fully
  // entitled. Treating canceled_at as "access has ended" would immediately
  // downgrade a still-paying, still-entitled customer.
  private resolveCancelAtPeriodEnd(sub: Stripe.Subscription, periodEndSeconds?: number): boolean {
    if (sub.cancel_at_period_end) return true;
    return sub.cancel_at != null && periodEndSeconds != null && sub.cancel_at === periodEndSeconds;
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
