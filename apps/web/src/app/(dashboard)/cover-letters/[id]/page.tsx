export const dynamic = 'force-dynamic';

import Link from 'next/link';
import { auth } from '@clerk/nextjs/server';
import { notFound, redirect } from 'next/navigation';

import { API_BASE_URL as API_URL } from '@/lib/apiUrl';
import { listCvs } from '@/lib/cvApi';
import type { CoverLetterDto } from '@/lib/coverLetterApi';
import { CoverLetterWorkspace } from '@/components/cover-letter/CoverLetterWorkspace';

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

  // The workspace only needs initialCvs for the CV picker, which is
  // hidden once a letter already exists (see CoverLetterWorkspace) — an
  // empty list here is harmless, but reusing the same fetch keeps the
  // linked CV's title/parseStatus consistent with the rest of the app.
  const cvs = await listCvs(token).catch(() => []);

  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center gap-4 border-b border-gray-200 bg-white px-4 py-3">
        <Link href="/cover-letters" className="text-sm text-indigo-600 hover:underline">
          ← Cover letter history
        </Link>
      </header>

      <CoverLetterWorkspace initialCvs={cvs} initialLetter={letter} />
    </div>
  );
}
