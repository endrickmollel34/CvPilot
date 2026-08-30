import { API_BASE_URL as API_URL } from './apiUrl';
import { throwApiError } from './apiError';

export type BillingPlan = 'pro' | 'student';

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
    throwApiError(body, `Failed to start checkout: ${res.status}`);
  }
  return res.json() as Promise<{ url: string | null }>;
}
