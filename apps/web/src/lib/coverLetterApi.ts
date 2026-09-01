import type { CvDto } from './cvApi';
import { API_BASE_URL as API_URL } from './apiUrl';
import { throwApiError } from './apiError';
import { authFetch, type TokenSource } from './authFetch';

export interface CoverLetterDto {
  id: string;
  cvId: string;
  analysisId?: string;
  jobTitle?: string;
  companyName?: string;
  content: string;
  tone: string;
  status: 'queued' | 'processing' | 'generated' | 'failed' | 'downloaded';
  createdAt: string;
  generatedAt?: string;
  // Undefined when the source CV has since been deleted — always optional.
  // Note: the original job description is never persisted for cover
  // letters (see the AI History investigation), so it is intentionally
  // not part of this DTO — never fabricate or display one.
  cv?: Pick<CvDto, 'id' | 'title' | 'fileName' | 'source'>;
}

export interface SubmitCoverLetterParams {
  cvId: string;
  analysisId?: string;
  jobTitle: string;
  companyName: string;
  jobDescription: string;
  tone: 'professional' | 'conversational' | 'enthusiastic' | 'formal';
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

export async function updateCoverLetter(
  token: TokenSource,
  id: string,
  content: string,
): Promise<CoverLetterDto> {
  const res = await authFetch(`${API_URL}/cover-letters/${id}`, token, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  });
  if (!res.ok) throw new Error(`Update failed: ${res.status}`);
  return res.json() as Promise<CoverLetterDto>;
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
