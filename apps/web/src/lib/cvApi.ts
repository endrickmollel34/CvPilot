import type { CvContent, CvSource } from '@cvpilot/shared';

import { API_BASE_URL as API_URL } from './apiUrl';
import { throwApiError } from './apiError';

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

function authHeaders(token: string): HeadersInit {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

export async function listCvs(token: string): Promise<CvDto[]> {
  const res = await fetch(`${API_URL}/cvs`, {
    headers: authHeaders(token),
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`Failed to list CVs: ${res.status}`);
  return res.json() as Promise<CvDto[]>;
}

export async function createCv(
  token: string,
  title: string,
  source: 'builder' | 'prefill' = 'builder',
): Promise<CvDto> {
  const res = await fetch(`${API_URL}/cvs`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({ title, source }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throwApiError(body, `Failed to create CV: ${res.status}`, res.status);
  }
  return res.json() as Promise<CvDto>;
}

export async function updateCvContent(
  token: string,
  cvId: string,
  content: CvContent,
): Promise<CvDto> {
  const res = await fetch(`${API_URL}/cvs/${cvId}`, {
    method: 'PATCH',
    headers: authHeaders(token),
    body: JSON.stringify({ content }),
  });
  if (!res.ok) throw new Error(`Failed to update CV content: ${res.status}`);
  return res.json() as Promise<CvDto>;
}

export async function deleteCv(token: string, cvId: string): Promise<void> {
  const res = await fetch(`${API_URL}/cvs/${cvId}`, {
    method: 'DELETE',
    headers: authHeaders(token),
  });
  if (!res.ok && res.status !== 204) throw new Error(`Failed to delete CV: ${res.status}`);
}

export async function downloadCvPdf(token: string, cvId: string, filename: string): Promise<void> {
  const res = await fetch(`${API_URL}/cvs/${cvId}/download`, {
    headers: { Authorization: `Bearer ${token}` },
  });
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

export async function getCv(token: string, cvId: string): Promise<CvDto> {
  const res = await fetch(`${API_URL}/cvs/${cvId}`, {
    headers: authHeaders(token),
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`Failed to fetch CV: ${res.status}`);
  return res.json() as Promise<CvDto>;
}

export async function getUploadUrl(
  token: string,
  fileName: string,
  mimeType: string,
  fileSizeBytes: number,
): Promise<{ uploadUrl: string; r2ObjectKey: string }> {
  const res = await fetch(`${API_URL}/cvs/upload-url`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({ fileName, mimeType, fileSizeBytes }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throwApiError(body, `Failed to get upload URL: ${res.status}`, res.status);
  }
  return res.json() as Promise<{ uploadUrl: string; r2ObjectKey: string }>;
}

export async function confirmUpload(
  token: string,
  r2ObjectKey: string,
  fileName: string,
  fileSizeBytes: number,
  mimeType: string,
): Promise<CvDto> {
  const res = await fetch(`${API_URL}/cvs/confirm`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({ r2ObjectKey, fileName, fileSizeBytes, mimeType }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throwApiError(body, `Failed to confirm upload: ${res.status}`, res.status);
  }
  return res.json() as Promise<CvDto>;
}

export async function renameCv(token: string, cvId: string, title: string): Promise<CvDto> {
  const res = await fetch(`${API_URL}/cvs/${cvId}/title`, {
    method: 'PATCH',
    headers: authHeaders(token),
    body: JSON.stringify({ title }),
  });
  if (!res.ok) throw new Error(`Failed to rename CV: ${res.status}`);
  return res.json() as Promise<CvDto>;
}

export async function prefillCv(token: string, uploadCvId: string): Promise<CvDto> {
  const res = await fetch(`${API_URL}/cvs/${uploadCvId}/prefill`, {
    method: 'POST',
    headers: authHeaders(token),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throwApiError(body, `Failed to prefill CV: ${res.status}`, res.status);
  }
  return res.json() as Promise<CvDto>;
}
