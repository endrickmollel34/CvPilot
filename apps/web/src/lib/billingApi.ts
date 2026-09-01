import type { Plan, SubscriptionStatus, UsageSummary } from '@cvpilot/shared';

import { API_BASE_URL as API_URL } from './apiUrl';
import { throwApiError } from './apiError';
import { authFetch, type TokenSource } from './authFetch';

export type { UsageSummary, UsageCounter } from '@cvpilot/shared';

export type BillingPlan = 'pro' | 'student';

export interface SubscriptionDto {
  plan: Plan;
  status: SubscriptionStatus;
  currentPeriodEnd?: string;
  cancelAtPeriodEnd: boolean;
}

export async function createCheckoutSession(
  token: TokenSource,
  plan: BillingPlan,
): Promise<{ url: string | null }> {
  const res = await authFetch(`${API_URL}/billing/checkout`, token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ plan }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throwApiError(body, `Failed to start checkout: ${res.status}`, res.status);
  }
  return res.json() as Promise<{ url: string | null }>;
}

// Null means the user has no subscription record at all (always the Free plan).
export async function getSubscription(token: TokenSource): Promise<SubscriptionDto | null> {
  const res = await authFetch(`${API_URL}/billing/subscription`, token, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Failed to fetch subscription: ${res.status}`);
  // Nest sends an empty body (not JSON `null`) when the controller returns
  // null — e.g. a Free-plan user with no subscription row. res.json() would
  // throw a SyntaxError parsing that empty body, so read as text first.
  const text = await res.text();
  return (text ? JSON.parse(text) : null) as SubscriptionDto | null;
}

export async function getUsage(token: TokenSource): Promise<UsageSummary> {
  const res = await authFetch(`${API_URL}/billing/usage`, token, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Failed to fetch usage: ${res.status}`);
  return res.json() as Promise<UsageSummary>;
}

export async function createPortalSession(token: TokenSource): Promise<{ url: string }> {
  const res = await authFetch(`${API_URL}/billing/portal`, token, { method: 'POST' });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throwApiError(body, `Failed to open billing portal: ${res.status}`, res.status);
  }
  return res.json() as Promise<{ url: string }>;
}
