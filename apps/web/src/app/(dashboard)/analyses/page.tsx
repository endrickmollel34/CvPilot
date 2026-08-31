export const dynamic = 'force-dynamic';

import Link from 'next/link';
import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';

import { listAnalyses } from '@/lib/analysisApi';

function ScoreBadge({ score }: { score: number }) {
  const color =
    score >= 70
      ? 'bg-green-100 text-green-700'
      : score >= 40
        ? 'bg-amber-100 text-amber-700'
        : 'bg-red-100 text-red-700';
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${color}`}
    >
      {score}%
    </span>
  );
}

const STATUS_LABELS: Record<string, string> = {
  pending: 'Pending',
  processing: 'Processing',
  done: 'Done',
  failed: 'Failed',
};

const STATUS_COLOR: Record<string, string> = {
  pending: 'bg-gray-100 text-gray-600',
  processing: 'bg-indigo-100 text-indigo-700',
  done: 'bg-green-100 text-green-700',
  failed: 'bg-red-100 text-red-700',
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export default async function AnalysesPage() {
  const { getToken, userId } = await auth();
  if (!userId) redirect('/sign-in');

  const token = await getToken();
  const analyses = token ? await listAnalyses(token).catch(() => []) : [];
  const sorted = [...analyses].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Analysis history</h1>
          <p className="mt-1 text-sm text-gray-500">Every CV-to-job match you have run.</p>
        </div>
        <Link
          href="/analyze"
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
        >
          New analysis
        </Link>
      </div>

      {sorted.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-gray-200 bg-white py-16 text-center">
          <p className="text-sm text-gray-400">You have not run any analyses yet.</p>
          <Link
            href="/analyze"
            className="mt-4 inline-block rounded-lg bg-indigo-600 px-5 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
          >
            Run your first analysis
          </Link>
        </div>
      ) : (
        <div className="rounded-xl border border-gray-200 bg-white shadow-sm divide-y divide-gray-100">
          {sorted.map((a) => (
            <Link
              key={a.id}
              href={`/analyses/${a.id}`}
              className="flex items-center justify-between px-5 py-3.5 hover:bg-gray-50"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-gray-900">
                  {a.jobTitle ?? 'Untitled role'}
                  {a.companyName ? ` — ${a.companyName}` : ''}
                </p>
                <p className="text-xs text-gray-400">
                  {a.cv ? (a.cv.title ?? a.cv.fileName ?? 'Uploaded CV') : 'Source CV unavailable'}{' '}
                  · {formatDate(a.createdAt)}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-3 ml-4">
                {a.status === 'done' && a.matchScore != null ? (
                  <ScoreBadge score={a.matchScore} />
                ) : (
                  <span
                    className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_COLOR[a.status] ?? 'bg-gray-100 text-gray-600'}`}
                  >
                    {STATUS_LABELS[a.status] ?? a.status}
                  </span>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
