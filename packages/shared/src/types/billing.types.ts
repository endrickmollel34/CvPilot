export type Plan = 'free' | 'pro' | 'student';

export type SubscriptionStatus = 'active' | 'past_due' | 'cancelled' | 'trialing' | 'incomplete';

export type PaymentStatus = 'pending' | 'succeeded' | 'failed' | 'refunded';

export type BillingCycle = 'recurring' | 'manual' | 'one_time';

export type PaymentProviderType = 'STRIPE' | 'CLICKPESA' | 'AZAMPAY';

export type PaymentMethodType =
  | 'CARD'
  | 'MPESA'
  | 'AIRTEL_MONEY'
  | 'MIXX_BY_YAS'
  | 'HALOPESA'
  | 'MOBILE_MONEY_OTHER';

export type Currency = 'GBP' | 'EUR' | 'USD' | 'TZS';

export type BillingEventType =
  | 'subscription.activated'
  | 'subscription.updated'
  | 'subscription.cancelled'
  | 'payment.succeeded'
  | 'payment.failed';

export interface UserPlan {
  plan: Plan;
  status: SubscriptionStatus;
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: Date | null;
}

export const PLAN_LIMITS: Record<
  Plan,
  {
    analysesPerMonth: number;
    coverLettersPerMonth: number;
    builderCvsTotal: number;
    tailoringsPerMonth: number;
  }
> = {
  free: { analysesPerMonth: 2, coverLettersPerMonth: 1, builderCvsTotal: 1, tailoringsPerMonth: 0 },
  pro: {
    analysesPerMonth: Infinity,
    coverLettersPerMonth: Infinity,
    builderCvsTotal: Infinity,
    tailoringsPerMonth: Infinity,
  },
  student: {
    analysesPerMonth: Infinity,
    coverLettersPerMonth: Infinity,
    builderCvsTotal: Infinity,
    tailoringsPerMonth: Infinity,
  },
};
