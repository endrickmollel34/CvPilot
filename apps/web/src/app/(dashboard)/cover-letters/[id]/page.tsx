export const dynamic = 'force-dynamic';

import Link from 'next/link';
import { auth } from '@clerk/nextjs/server';
import { notFound, redirect } from 'next/navigation';

import { API_BASE_URL as API_URL } from '@/lib/apiUrl';
import type { CoverLetterDto } from '@/lib/coverLetterApi';
import { CoverLetterViewer } from '@/components/cover-letter/CoverLetterViewer';

async function fetchCoverLetter(token: string, id: string): Promise<CoverLetterDto | null> {
  const res = await fetch(`${API_URL}/cover-letters/${id}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Failed to fetch cover letter: ${res.status}`);
  return res.json() as Promise<CoverLetterDto>;
}

interface Props {
  params: Promise<{ id: string }>;
}

export default async function CoverLetterDetailPage({ params }: Props) {
  const { id } = await params;
  const { getToken, userId } = await auth();
  if (!userId) redirect('/sign-in');

  const token = await getToken();
  if (!token) redirect('/sign-in');

  const letter = await fetchCoverLetter(token, id);
  if (!letter) notFound();

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <div className="mb-6">
        <Link href="/cover-letters" className="text-sm text-indigo-600 hover:underline">
          ← Cover letter history
        </Link>
      </div>

      {(letter.status === 'generated' || letter.status === 'downloaded') && (
        <CoverLetterViewer letter={letter} />
      )}

      {letter.status === 'failed' && (
        <div className="mx-auto max-w-3xl rounded-xl border border-red-200 bg-red-50 p-6 text-center">
          <p className="text-sm font-medium text-red-700">This cover letter failed to generate.</p>
          <p className="mt-1 text-xs text-red-500">No content was saved for this run.</p>
          <Link
            href="/cover-letter"
            className="mt-4 inline-block rounded-md bg-indigo-600 px-4 py-2 text-xs font-medium text-white hover:bg-indigo-700"
          >
            Try again
          </Link>
        </div>
      )}

      {(letter.status === 'queued' || letter.status === 'processing') && (
        <div className="mx-auto max-w-3xl rounded-xl border border-gray-200 bg-white p-10 text-center shadow-sm">
          <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-4 border-indigo-200 border-t-indigo-600" />
          <p className="text-sm text-gray-600">This cover letter is still {letter.status}.</p>
          <p className="mt-1 text-xs text-gray-400">
            Check back shortly — this page does not auto-refresh.
          </p>
        </div>
      )}
    </div>
  );
}
