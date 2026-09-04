import type { ContactCategory } from '@cvpilot/shared';

import { API_BASE_URL as API_URL } from './apiUrl';
import { throwApiError } from './apiError';

export interface SubmitContactInput {
  name: string;
  email: string;
  category: ContactCategory;
  message: string;
  // Honeypot — always empty for a real visitor. See ContactForm.tsx.
  website?: string;
}

// Unlike every other apps/web/lib/*Api.ts module, this deliberately calls
// plain fetch() rather than authFetch() — /contact must work for anonymous,
// signed-out visitors (see middleware.ts's public route list), so there is
// no Clerk token to attach.
export async function submitContact(input: SubmitContactInput): Promise<void> {
  const res = await fetch(`${API_URL}/contact`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throwApiError(body, `Failed to send message: ${res.status}`, res.status);
  }
}
