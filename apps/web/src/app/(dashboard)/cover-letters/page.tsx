export const dynamic = 'force-dynamic';

import Link from 'next/link';
import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';

import { listCoverLetters } from '@/lib/coverLetterApi';
import { CoverLetterHistoryList } from '@/components/cover-letter/CoverLetterHistoryList';

export default async function CoverLettersPage() {
  const { getToken, userId } = await auth();
  if (!userId) redirect('/sign-in');

  const token = await getToken();
  const emptyResult = {
    items: [] as Awaited<ReturnType<typeof listCoverLetters>>['items'],
    total: 0,
    page: 1,
    limit: 50,
  };
  const { items } = token
    ? await listCoverLetters(token, 1, 50).catch(() => emptyResult)
    : emptyResult;

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Cover letter history</h1>
          <p className="mt-1 text-sm text-gray-500">Every cover letter you have generated.</p>
        </div>
        <Link
          href="/cover-letter"
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
        >
          New letter
        </Link>
      </div>

      <CoverLetterHistoryList initialItems={items} />
    </div>
  );
}
