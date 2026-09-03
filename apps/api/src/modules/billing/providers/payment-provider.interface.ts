import type {
  PaymentProviderType,
  PaymentMethodType,
  Currency,
  Plan,
  SubscriptionStatus,
  PaymentStatus,
  BillingEventType,
} from '@cvpilot/shared';

export interface CheckoutSessionParams {
  userId: string;
  providerCustomerId?: string;
  plan: Exclude<Plan, 'free'>;
  currency: Currency;
  successUrl: string;
  cancelUrl: string;
}

export interface CustomerPortalParams {
  providerCustomerId: string;
  returnUrl: string;
}

export interface WebhookParams {
  rawBody: Buffer;
  signature: string;
}

export interface InternalBillingEvent {
  type: BillingEventType;
  provider: PaymentProviderType;
  providerCustomerId?: string;
  providerSubscriptionId?: string;
  providerPaymentId?: string;
  providerTransactionReference?: string;
  plan?: Plan;
  subscriptionStatus?: SubscriptionStatus;
  paymentStatus?: PaymentStatus;
  paymentMethod?: PaymentMethodType;
  amountMinorUnits?: number;
  currency?: Currency;
  currentPeriodStart?: Date;
  currentPeriodEnd?: Date;
  /**
   * "This subscription is scheduled to lose paid access at the current
   * billing period's end" — an intentionally *interpreted* meaning, not a
   * direct mirror of the provider's own cancel-at-period-end boolean.
   * Production evidence (2026-09-03 incident) proved a subscription can be
   * genuinely scheduled to end at the current period boundary while
   * Stripe's cancel_at_period_end field itself stays false — Stripe's
   * Customer Portal cancellation flow, under CVPilot's current API
   * version/billing mode, represents this via `cancel_at` (a timestamp)
   * landing exactly on the period end instead. See
   * StripePaymentProvider.resolveCancelAtPeriodEnd for the exact derivation
   * every provider implementation must reproduce.
   */
  cancelAtPeriodEnd?: boolean;
  /**
   * The provider's raw scheduled-cancellation timestamp, if any — present
   * whenever the provider reports one, regardless of whether it lines up
   * with the current period end (i.e. even when cancelAtPeriodEnd above is
   * false, because it was scheduled for a future period boundary instead).
   * Not yet persisted to the subscriptions table or surfaced to the
   * frontend — kept here for diagnostic logging and so a future feature
   * (e.g. displaying a cancellation scheduled for a non-current period)
   * doesn't need another round of Stripe-shape archaeology to add.
   */
  cancelAt?: Date;
  metadata?: Record<string, unknown>;
}

export interface PaymentProvider {
  readonly providerType: PaymentProviderType;

  createCheckoutSession(params: CheckoutSessionParams): Promise<{ url: string | null }>;

  /** Optional — not all providers support a self-service portal. */
  createCustomerPortalSession?(params: CustomerPortalParams): Promise<{ url: string }>;

  /**
   * Verifies the provider signature and maps the raw payload to an
   * InternalBillingEvent. Throws BadRequestException on invalid signature.
   * Returns null for valid-but-unhandled event types.
   *
   * Async: some event types (subscription updates — see StripePaymentProvider)
   * re-fetch the live object from the provider's API rather than trusting the
   * payload embedded in the webhook delivery, because webhook delivery order
   * is never guaranteed (Stripe explicitly documents this and explicitly
   * recommends re-fetching for exactly this reason). Trusting the embedded
   * snapshot for a field that can flip back and forth (e.g. cancel-at-period-
   * end) risks a stale, out-of-order delivery overwriting a fresher one.
   */
  verifyAndParseWebhook(params: WebhookParams): Promise<InternalBillingEvent | null>;

  /** Optional — only meaningful for providers with recurring subscription support. */
  cancelSubscription?(providerSubscriptionId: string): Promise<void>;
}
