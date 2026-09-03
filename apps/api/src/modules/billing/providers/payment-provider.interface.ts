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
  cancelAtPeriodEnd?: boolean;
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
