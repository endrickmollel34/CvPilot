import type { TailoringDecision, TailoringSuggestion, TailoringStatus } from '@cvpilot/shared';

import { API_BASE_URL as API_URL } from './apiUrl';
import { throwApiError } from './apiError';

export interface TailoringDto {
  id: string;
  userId: string;
  masterCvId: string;
  tailoredCvId?: string;
  jobTitle?: string;
  companyName?: string;
  jobDescription: string;
  suggestions?: TailoringSuggestion[];
  decisions?: TailoringDecision[];
  modelUsed?: string;
  tokensUsed?: number;
  status: TailoringStatus;
  createdAt: string;
  completedAt?: string;
}

export async function submitTailoring(
  token: string,
  cvId: string,
  jobTitle: string | undefined,
  companyName: string | undefined,
  jobDescription: string,
): Promise<TailoringDto> {
  const res = await fetch(`${API_URL}/tailorings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      cvId,
      jobTitle: jobTitle || undefined,
      companyName: companyName || undefined,
      jobDescription,
    }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throwApiError(body, `Submit failed: ${res.status}`);
  }
  return res.json() as Promise<TailoringDto>;
}

export async function getTailoring(token: string, tailoringId: string): Promise<TailoringDto> {
  const res = await fetch(`${API_URL}/tailorings/${tailoringId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
  return res.json() as Promise<TailoringDto>;
}

export async function applyTailoring(
  token: string,
  tailoringId: string,
  decisions: TailoringDecision[],
): Promise<{ tailoredCvId: string }> {
  const res = await fetch(`${API_URL}/tailorings/${tailoringId}/apply`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ decisions }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throwApiError(body, `Apply failed: ${res.status}`);
  }
  return res.json() as Promise<{ tailoredCvId: string }>;
}
