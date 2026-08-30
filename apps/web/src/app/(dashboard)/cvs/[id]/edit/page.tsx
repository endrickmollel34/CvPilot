export const dynamic = 'force-dynamic';

import Link from 'next/link';
import { auth } from '@clerk/nextjs/server';
import { notFound, redirect } from 'next/navigation';

import { CvBuilderWorkspace } from '@/components/cv/CvBuilderWorkspace';
import { API_BASE_URL as API_URL } from '@/lib/apiUrl';

async function fetchCv(token: string, cvId: string) {
  const res = await fetch(`${API_URL}/cvs/${cvId}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Failed to fetch CV: ${res.status}`);
  return res.json() as Promise<{ id: string; title?: string; source: string; content?: unknown }>;
}

interface Props {
  params: Promise<{ id: string }>;
}

export default async function CvBuilderPage({ params }: Props) {
  const { id } = await params;
  const { getToken, userId } = await auth();
  if (!userId) redirect('/sign-in');

  const token = await getToken();
  if (!token) redirect('/sign-in');

  const cv = await fetchCv(token, id);
  if (!cv) notFound();

  if (cv.source === 'upload') {
    redirect('/cvs');
  }

  return (
    <div className="flex h-screen flex-col">
      {/* Top bar */}
      <header className="flex items-center gap-4 border-b border-gray-200 bg-white px-4 py-3">
        <Link href="/cvs" className="text-sm text-indigo-600 hover:underline">
          ← My CVs
        </Link>
        <h1 className="truncate font-semibold text-gray-900">{cv.title ?? 'Untitled CV'}</h1>
      </header>

      <CvBuilderWorkspace
        cvId={cv.id}
        initialContent={cv.content as Parameters<typeof CvBuilderWorkspace>[0]['initialContent']}
        isPrefilled={cv.source === 'prefill'}
      />
    </div>
  );
}
