import type { CvDto } from './cvApi';
import { API_BASE_URL as API_URL } from './apiUrl';
import { throwApiError } from './apiError';
import { authFetch, type TokenSource } from './authFetch';

export type CoverLetterTone = 'professional' | 'conversational' | 'enthusiastic' | 'formal';

export interface CoverLetterDto {
  id: string;
  cvId: string;
  analysisId?: string;
  jobTitle?: string;
  companyName?: string;
  // V2 — persisted so the workspace can redisplay/edit them later and so
  // Regenerate has something to send back to the AI service. Undefined on
  // any letter created before this field existed.
  jobDescription?: string;
  recipientName?: string;
  recipientTitle?: string;
  companyAddress?: string;
  // V2.1 — the candidate's own postal address for the sender block of a
  // proper two-sided business letter. Optional, never inferred from the
  // CV — see cover-letter.entity.ts's senderAddress doc comment.
  senderAddress?: string | null;
  content: string;
  tone: string;
  status: 'queued' | 'processing' | 'generated' | 'failed' | 'downloaded';
  createdAt: string;
  generatedAt?: string;
  // Undefined when the source CV has since been deleted — always optional.
  // `content` (personalDetails) is included so the live preview/PDF can
  // build a candidate letterhead — the backend already returns the full
  // relation, this was just never declared on the frontend type before.
  cv?: Pick<CvDto, 'id' | 'title' | 'fileName' | 'source' | 'content'>;
}

export interface SubmitCoverLetterParams {
  cvId: string;
  analysisId?: string;
  jobTitle: string;
  companyName: string;
  jobDescription: string;
  tone: CoverLetterTone;
  recipientName?: string;
  recipientTitle?: string;
  companyAddress?: string;
  senderAddress?: string;
}

export async function submitCoverLetter(
  token: TokenSource,
  params: SubmitCoverLetterParams,
): Promise<CoverLetterDto> {
  const res = await authFetch(`${API_URL}/cover-letters`, token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throwApiError(body, `Submit failed: ${res.status}`, res.status);
  }
  return res.json() as Promise<CoverLetterDto>;
}

export async function getCoverLetter(token: TokenSource, id: string): Promise<CoverLetterDto> {
  const res = await authFetch(`${API_URL}/cover-letters/${id}`, token, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
  return res.json() as Promise<CoverLetterDto>;
}

export async function listCoverLetters(
  token: TokenSource,
  page = 1,
  limit = 20,
): Promise<{ items: CoverLetterDto[]; total: number; page: number; limit: number }> {
  const res = await authFetch(`${API_URL}/cover-letters?page=${page}&limit=${limit}`, token, {
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`List failed: ${res.status}`);
  return res.json() as Promise<{
    items: CoverLetterDto[];
    total: number;
    page: number;
    limit: number;
  }>;
}

// V2 — a genuine partial update: pass only the fields that changed.
// Mirrors UpdateCoverLetterDto on the backend, which now accepts any
// subset of these (see its own doc comment for why).
export interface UpdateCoverLetterParams {
  content?: string;
  jobTitle?: string;
  companyName?: string;
  jobDescription?: string;
  tone?: CoverLetterTone;
  recipientName?: string;
  recipientTitle?: string;
  companyAddress?: string;
  // V2.1 — `null` explicitly clears a previously-set sender address;
  // `undefined`/omitted leaves it unchanged. See UpdateCoverLetterDto.
  senderAddress?: string | null;
}

export async function updateCoverLetter(
  token: TokenSource,
  id: string,
  patch: UpdateCoverLetterParams,
): Promise<CoverLetterDto> {
  const res = await authFetch(`${API_URL}/cover-letters/${id}`, token, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(`Update failed: ${res.status}`);
  return res.json() as Promise<CoverLetterDto>;
}

// V2 — re-runs generation using whatever is currently persisted for this
// letter (the workspace saves field edits via updateCoverLetter() first).
// No body: "persisted" means "whatever was last saved".
export async function regenerateCoverLetter(
  token: TokenSource,
  id: string,
): Promise<CoverLetterDto> {
  const res = await authFetch(`${API_URL}/cover-letters/${id}/regenerate`, token, {
    method: 'POST',
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throwApiError(body, `Regenerate failed: ${res.status}`, res.status);
  }
  return res.json() as Promise<CoverLetterDto>;
}

// Mirrors the backend's R2-first-then-DB deletion (see cover-letter.service.ts):
// a 503 here means the stored PDF couldn't be cleaned up and the letter was
// deliberately NOT deleted, so its backend-provided message is safe to show
// as-is (it never contains R2 internals — see r2-storage.service.ts).
export async function deleteCoverLetter(token: TokenSource, id: string): Promise<void> {
  const res = await authFetch(`${API_URL}/cover-letters/${id}`, token, { method: 'DELETE' });
  if (res.ok || res.status === 204) return;
  const body = await res.json().catch(() => ({}));
  throwApiError(body, 'Could not delete this cover letter. Please try again.', res.status);
}

export async function downloadCoverLetterPdf(token: TokenSource, id: string): Promise<void> {
  const res = await authFetch(`${API_URL}/cover-letters/${id}/download`, token, {
    method: 'POST',
  });
  if (!res.ok) throw new Error(`Download request failed: ${res.status}`);
  const { downloadUrl } = (await res.json()) as { downloadUrl: string };
  const a = document.createElement('a');
  a.href = downloadUrl;
  a.download = 'cover-letter.pdf';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}
