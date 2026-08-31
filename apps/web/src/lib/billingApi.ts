import type { Plan, SubscriptionStatus, UsageSummary } from '@cvpilot/shared';

import { API_BASE_URL as API_URL } from './apiUrl';
import { throwApiError } from './apiError';

export type { UsageSummary, UsageCounter } from '@cvpilot/shared';

export type BillingPlan = 'pro' | 'student';

export interface SubscriptionDto {
  plan: Plan;
  status: SubscriptionStatus;
  currentPeriodEnd?: string;
  cancelAtPeriodEnd: boolean;
}

export async function createCheckoutSession(
  token: string,
  plan: BillingPlan,
): Promise<{ url: string | null }> {
  const res = await fetch(`${API_URL}/billing/checkout`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ plan }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throwApiError(body, `Failed to start checkout: ${res.status}`, res.status);
  }
  return res.json() as Promise<{ url: string | null }>;
}

// Null means the user has no subscription record at all (always the Free plan).
export async function getSubscription(token: string): Promise<SubscriptionDto | null> {
  const res = await fetch(`${API_URL}/billing/subscription`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`Failed to fetch subscription: ${res.status}`);
  return res.json() as Promise<SubscriptionDto | null>;
}

export async function getUsage(token: string): Promise<UsageSummary> {
  const res = await fetch(`${API_URL}/billing/usage`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`Failed to fetch usage: ${res.status}`);
  return res.json() as Promise<UsageSummary>;
}

export async function createPortalSession(token: string): Promise<{ url: string }> {
  const res = await fetch(`${API_URL}/billing/portal`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throwApiError(body, `Failed to open billing portal: ${res.status}`, res.status);
  }
  return res.json() as Promise<{ url: string }>;
}
