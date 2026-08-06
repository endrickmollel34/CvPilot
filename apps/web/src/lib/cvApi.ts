import type { CvContent, CvSource } from '@cvpilot/shared';

const API_URL = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3001';

export interface CvDto {
  id: string;
  title?: string;
  source: CvSource;
  fileName?: string;
  parseStatus: 'pending' | 'processing' | 'done' | 'failed';
  content?: CvContent;
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
    const body = (await res.json().catch(() => ({}))) as { message?: string };
    throw new Error(body.message ?? `Failed to create CV: ${res.status}`);
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
