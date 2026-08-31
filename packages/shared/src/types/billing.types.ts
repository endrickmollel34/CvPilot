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

// ── Usage visibility ─────────────────────────────────────────────────────────
// Shared between apps/api (BillingService.getUsageSummary) and apps/web
// (the dashboard usage card + contextual hints) so the frontend never needs
// its own copy of PLAN_LIMITS or quota-counting rules.

export interface UsageCounter {
  used: number;
  /** null means unlimited (never a serialized Infinity). */
  limit: number | null;
  /** null means unlimited. */
  remaining: number | null;
}

export interface UsageSummary {
  /** The plan that actually governs entitlements right now (see resolveEffectivePlan). */
  plan: Plan;
  /** The raw, stored plan — may differ from `plan` for e.g. a past_due Pro subscription. Omitted when there is no subscription row. */
  rawPlan?: Plan;
  /** Omitted when there is no subscription row. */
  subscriptionStatus?: SubscriptionStatus;
  usage: {
    analyses: UsageCounter;
    coverLetters: UsageCounter;
    tailorings: UsageCounter;
    builderCvs: UsageCounter;
  };
}
