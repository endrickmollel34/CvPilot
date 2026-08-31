export const dynamic = 'force-dynamic';

import Link from 'next/link';
import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';

import { listCoverLetters } from '@/lib/coverLetterApi';

const STATUS_LABELS: Record<string, string> = {
  queued: 'Queued',
  processing: 'Processing',
  generated: 'Ready',
  downloaded: 'Downloaded',
  failed: 'Failed',
};

const STATUS_COLOR: Record<string, string> = {
  queued: 'bg-gray-100 text-gray-600',
  processing: 'bg-indigo-100 text-indigo-700',
  generated: 'bg-green-100 text-green-700',
  downloaded: 'bg-green-100 text-green-700',
  failed: 'bg-red-100 text-red-700',
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

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

      {items.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-gray-200 bg-white py-16 text-center">
          <p className="text-sm text-gray-400">You have not generated any cover letters yet.</p>
          <Link
            href="/cover-letter"
            className="mt-4 inline-block rounded-lg bg-indigo-600 px-5 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
          >
            Generate your first letter
          </Link>
        </div>
      ) : (
        <div className="rounded-xl border border-gray-200 bg-white shadow-sm divide-y divide-gray-100">
          {items.map((l) => (
            <Link
              key={l.id}
              href={`/cover-letters/${l.id}`}
              className="flex items-center justify-between px-5 py-3.5 hover:bg-gray-50"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-gray-900">
                  {l.jobTitle ?? 'Untitled role'}
                  {l.companyName ? ` — ${l.companyName}` : ''}
                </p>
                <p className="text-xs capitalize text-gray-400">
                  {l.cv ? (l.cv.title ?? l.cv.fileName ?? 'Uploaded CV') : 'Source CV unavailable'}{' '}
                  · {l.tone} · {formatDate(l.createdAt)}
                </p>
              </div>
              <span
                className={`ml-4 inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_COLOR[l.status] ?? 'bg-gray-100 text-gray-600'}`}
              >
                {STATUS_LABELS[l.status] ?? l.status}
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
