import type { CvDto } from './cvApi';
import { API_BASE_URL as API_URL } from './apiUrl';
import { throwApiError } from './apiError';

function authHeaders(token: string): HeadersInit {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

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
  token: string,
  params: SubmitCoverLetterParams,
): Promise<CoverLetterDto> {
  const res = await fetch(`${API_URL}/cover-letters`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify(params),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throwApiError(body, `Submit failed: ${res.status}`, res.status);
  }
  return res.json() as Promise<CoverLetterDto>;
}

export async function getCoverLetter(token: string, id: string): Promise<CoverLetterDto> {
  const res = await fetch(`${API_URL}/cover-letters/${id}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
  return res.json() as Promise<CoverLetterDto>;
}

export async function listCoverLetters(
  token: string,
  page = 1,
  limit = 20,
): Promise<{ items: CoverLetterDto[]; total: number; page: number; limit: number }> {
  const res = await fetch(`${API_URL}/cover-letters?page=${page}&limit=${limit}`, {
    headers: { Authorization: `Bearer ${token}` },
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
  token: string,
  id: string,
  content: string,
): Promise<CoverLetterDto> {
  const res = await fetch(`${API_URL}/cover-letters/${id}`, {
    method: 'PATCH',
    headers: authHeaders(token),
    body: JSON.stringify({ content }),
  });
  if (!res.ok) throw new Error(`Update failed: ${res.status}`);
  return res.json() as Promise<CoverLetterDto>;
}

export async function downloadCoverLetterPdf(token: string, id: string): Promise<void> {
  const res = await fetch(`${API_URL}/cover-letters/${id}/download`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
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
