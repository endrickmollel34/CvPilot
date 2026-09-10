import type { CvDto } from './cvApi';
import { API_BASE_URL as API_URL } from './apiUrl';
import { throwApiError } from './apiError';
import { authFetch, type TokenSource } from './authFetch';

export interface AtsReportDto {
  atsScore?: number;
  keywordHits?: Array<{ keyword: string; found: boolean }>;
  missingKeywords?: string[];
}

export interface AnalysisDto {
  id: string;
  cvId: string;
  jobTitle?: string;
  companyName?: string;
  jobDescription: string;
  matchScore?: number;
  suggestions?: Array<{ category: string; priority: string; text: string }>;
  status: 'pending' | 'processing' | 'done' | 'failed';
  createdAt: string;
  completedAt?: string;
  atsReport?: AtsReportDto;
  // Undefined when the source CV has since been deleted — always optional.
  cv?: Pick<CvDto, 'id' | 'title' | 'fileName' | 'source'>;
}

export async function submitAnalysis(
  token: TokenSource,
  cvId: string,
  jobTitle: string,
  companyName: string | undefined,
  jobDescription: string,
): Promise<AnalysisDto> {
  const res = await authFetch(`${API_URL}/analyses`, token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cvId, jobTitle, companyName: companyName || undefined, jobDescription }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throwApiError(body, `Submit failed: ${res.status}`, res.status);
  }
  return res.json() as Promise<AnalysisDto>;
}

export async function getAnalysis(token: TokenSource, id: string): Promise<AnalysisDto> {
  const res = await authFetch(`${API_URL}/analyses/${id}`, token, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
  return res.json() as Promise<AnalysisDto>;
}

export async function listAnalyses(token: TokenSource): Promise<AnalysisDto[]> {
  const res = await authFetch(`${API_URL}/analyses`, token, { cache: 'no-store' });
  if (!res.ok) throw new Error(`List failed: ${res.status}`);
  return res.json() as Promise<AnalysisDto[]>;
}

// A genuine hard delete on the backend (analysis.service.ts): the row and
// its ATS report are gone; the source CV is never touched.
export async function deleteAnalysis(token: TokenSource, id: string): Promise<void> {
  const res = await authFetch(`${API_URL}/analyses/${id}`, token, { method: 'DELETE' });
  if (res.ok || res.status === 204) return;
  const body = await res.json().catch(() => ({}));
  throwApiError(body, 'Could not delete this analysis. Please try again.', res.status);
}
