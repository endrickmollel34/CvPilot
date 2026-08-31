export const dynamic = 'force-dynamic';

import Link from 'next/link';
import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';

import { listTailorings } from '@/lib/tailoringApi';

const STATUS_LABELS: Record<string, string> = {
  pending: 'Pending',
  processing: 'Processing',
  done: 'Ready to review',
  applied: 'Applied',
  failed: 'Failed',
};

const STATUS_COLOR: Record<string, string> = {
  pending: 'bg-gray-100 text-gray-600',
  processing: 'bg-indigo-100 text-indigo-700',
  done: 'bg-amber-100 text-amber-700',
  applied: 'bg-green-100 text-green-700',
  failed: 'bg-red-100 text-red-700',
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function truncate(text: string, max: number) {
  return text.length > max ? `${text.slice(0, max).trimEnd()}…` : text;
}

export default async function TailoringsPage() {
  const { getToken, userId } = await auth();
  if (!userId) redirect('/sign-in');

  const token = await getToken();
  const tailorings = token ? await listTailorings(token).catch(() => []) : [];
  const sorted = [...tailorings].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Tailoring history</h1>
          <p className="mt-1 text-sm text-gray-500">Every CV tailoring job you have run.</p>
        </div>
        <Link
          href="/cvs"
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
        >
          Tailor a CV
        </Link>
      </div>

      {sorted.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-gray-200 bg-white py-16 text-center">
          <p className="text-sm text-gray-400">You have not run any tailorings yet.</p>
          <Link
            href="/cvs"
            className="mt-4 inline-block rounded-lg bg-indigo-600 px-5 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
          >
            Tailor a CV for a job
          </Link>
        </div>
      ) : (
        <div className="rounded-xl border border-gray-200 bg-white shadow-sm divide-y divide-gray-100">
          {sorted.map((t) => (
            <Link
              key={t.id}
              href={`/tailorings/${t.id}`}
              className="flex items-center justify-between px-5 py-3.5 hover:bg-gray-50"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-gray-900">
                  {t.jobTitle ?? truncate(t.jobDescription, 80)}
                  {t.companyName ? ` — ${t.companyName}` : ''}
                </p>
                <p className="text-xs text-gray-400">
                  {t.masterCv
                    ? (t.masterCv.title ?? t.masterCv.fileName ?? 'CV')
                    : 'Source CV unavailable'}{' '}
                  · {formatDate(t.createdAt)}
                  {t.status === 'applied' ? ' · Applied' : ''}
                </p>
              </div>
              <span
                className={`ml-4 inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_COLOR[t.status] ?? 'bg-gray-100 text-gray-600'}`}
              >
                {STATUS_LABELS[t.status] ?? t.status}
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
