export type Plan = 'free' | 'pro' | 'student';

export type SubscriptionStatus = 'active' | 'past_due' | 'canceled' | 'trialing' | 'incomplete';

export interface UserPlan {
  plan: Plan;
  status: SubscriptionStatus;
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: Date | null;
}

export const PLAN_LIMITS: Record<Plan, { analysesPerMonth: number; coverLettersPerMonth: number }> =
  {
    free: { analysesPerMonth: 2, coverLettersPerMonth: 1 },
    pro: { analysesPerMonth: Infinity, coverLettersPerMonth: Infinity },
    student: { analysesPerMonth: Infinity, coverLettersPerMonth: Infinity },
  };
