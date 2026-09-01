import type { CvContent, CvSource } from '@cvpilot/shared';

import { API_BASE_URL as API_URL } from './apiUrl';
import { throwApiError } from './apiError';
import { authFetch, type TokenSource } from './authFetch';

export interface CvDto {
  id: string;
  title?: string;
  source: CvSource;
  fileName?: string;
  parseStatus: 'pending' | 'processing' | 'done' | 'failed';
  content?: CvContent;
  sourceUploadCvId?: string;
  createdAt: string;
  updatedAt: string;
}

export async function listCvs(token: TokenSource): Promise<CvDto[]> {
  const res = await authFetch(`${API_URL}/cvs`, token, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Failed to list CVs: ${res.status}`);
  return res.json() as Promise<CvDto[]>;
}

export async function createCv(
  token: TokenSource,
  title: string,
  source: 'builder' | 'prefill' = 'builder',
): Promise<CvDto> {
  const res = await authFetch(`${API_URL}/cvs`, token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, source }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throwApiError(body, `Failed to create CV: ${res.status}`, res.status);
  }
  return res.json() as Promise<CvDto>;
}

export async function updateCvContent(
  token: TokenSource,
  cvId: string,
  content: CvContent,
): Promise<CvDto> {
  const res = await authFetch(`${API_URL}/cvs/${cvId}`, token, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  });
  if (!res.ok) throw new Error(`Failed to update CV content: ${res.status}`);
  return res.json() as Promise<CvDto>;
}

export async function deleteCv(token: TokenSource, cvId: string): Promise<void> {
  const res = await authFetch(`${API_URL}/cvs/${cvId}`, token, { method: 'DELETE' });
  if (!res.ok && res.status !== 204) throw new Error(`Failed to delete CV: ${res.status}`);
}

export async function downloadCvPdf(
  token: TokenSource,
  cvId: string,
  filename: string,
): Promise<void> {
  const res = await authFetch(`${API_URL}/cvs/${cvId}/download`, token);
  if (!res.ok) throw new Error(`PDF download failed: ${res.status}`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export async function getCv(token: TokenSource, cvId: string): Promise<CvDto> {
  const res = await authFetch(`${API_URL}/cvs/${cvId}`, token, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Failed to fetch CV: ${res.status}`);
  return res.json() as Promise<CvDto>;
}

export async function getUploadUrl(
  token: TokenSource,
  fileName: string,
  mimeType: string,
  fileSizeBytes: number,
): Promise<{ uploadUrl: string; r2ObjectKey: string }> {
  const res = await authFetch(`${API_URL}/cvs/upload-url`, token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fileName, mimeType, fileSizeBytes }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throwApiError(body, `Failed to get upload URL: ${res.status}`, res.status);
  }
  return res.json() as Promise<{ uploadUrl: string; r2ObjectKey: string }>;
}

export async function confirmUpload(
  token: TokenSource,
  r2ObjectKey: string,
  fileName: string,
  fileSizeBytes: number,
  mimeType: string,
): Promise<CvDto> {
  const res = await authFetch(`${API_URL}/cvs/confirm`, token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ r2ObjectKey, fileName, fileSizeBytes, mimeType }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throwApiError(body, `Failed to confirm upload: ${res.status}`, res.status);
  }
  return res.json() as Promise<CvDto>;
}

export async function renameCv(token: TokenSource, cvId: string, title: string): Promise<CvDto> {
  const res = await authFetch(`${API_URL}/cvs/${cvId}/title`, token, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title }),
  });
  if (!res.ok) throw new Error(`Failed to rename CV: ${res.status}`);
  return res.json() as Promise<CvDto>;
}

export async function prefillCv(token: TokenSource, uploadCvId: string): Promise<CvDto> {
  const res = await authFetch(`${API_URL}/cvs/${uploadCvId}/prefill`, token, { method: 'POST' });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throwApiError(body, `Failed to prefill CV: ${res.status}`, res.status);
  }
  return res.json() as Promise<CvDto>;
}
