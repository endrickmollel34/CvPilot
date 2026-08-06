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
   */
  verifyAndParseWebhook(params: WebhookParams): InternalBillingEvent | null;

  /** Optional — only meaningful for providers with recurring subscription support. */
  cancelSubscription?(providerSubscriptionId: string): Promise<void>;
}
