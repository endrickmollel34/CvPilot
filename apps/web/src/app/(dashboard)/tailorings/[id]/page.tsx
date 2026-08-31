export const dynamic = 'force-dynamic';

import Link from 'next/link';
import { auth } from '@clerk/nextjs/server';
import { notFound, redirect } from 'next/navigation';

import { API_BASE_URL as API_URL } from '@/lib/apiUrl';
import type { TailoringDto } from '@/lib/tailoringApi';
import { TailoringReview } from '@/components/tailoring/TailoringReview';
import { TailoringAppliedView } from '@/components/tailoring/TailoringAppliedView';

async function fetchTailoring(token: string, id: string): Promise<TailoringDto | null> {
  const res = await fetch(`${API_URL}/tailorings/${id}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Failed to fetch tailoring: ${res.status}`);
  return res.json() as Promise<TailoringDto>;
}

interface Props {
  params: Promise<{ id: string }>;
}

export default async function TailoringDetailPage({ params }: Props) {
  const { id } = await params;
  const { getToken, userId } = await auth();
  if (!userId) redirect('/sign-in');

  const token = await getToken();
  if (!token) redirect('/sign-in');

  const tailoring = await fetchTailoring(token, id);
  if (!tailoring) notFound();

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <div className="mb-2 px-4">
        <Link href="/tailorings" className="text-sm text-indigo-600 hover:underline">
          ← Tailoring history
        </Link>
      </div>

      {/* 'done' — suggestions ready, not yet applied. Reopens the same
          review/accept/reject/apply experience as the live flow, using the
          persisted suggestions only — no new AI request. */}
      {tailoring.status === 'done' && <TailoringReview tailoring={tailoring} />}

      {/* 'applied' — read-only history view of what was actually applied. */}
      {tailoring.status === 'applied' && <TailoringAppliedView tailoring={tailoring} />}

      {tailoring.status === 'failed' && (
        <div className="mx-auto max-w-3xl rounded-xl border border-red-200 bg-red-50 p-6 text-center">
          <p className="text-sm font-medium text-red-700">This tailoring failed to complete.</p>
          <p className="mt-1 text-xs text-red-500">No suggestions were saved for this run.</p>
          {tailoring.masterCv ? (
            <Link
              href={`/cvs/${tailoring.masterCv.id}/tailor`}
              className="mt-4 inline-block rounded-md bg-indigo-600 px-4 py-2 text-xs font-medium text-white hover:bg-indigo-700"
            >
              Try again
            </Link>
          ) : (
            <Link
              href="/cvs"
              className="mt-4 inline-block rounded-md bg-indigo-600 px-4 py-2 text-xs font-medium text-white hover:bg-indigo-700"
            >
              Start a new tailoring
            </Link>
          )}
        </div>
      )}

      {(tailoring.status === 'pending' || tailoring.status === 'processing') && (
        <div className="mx-auto max-w-3xl rounded-xl border border-gray-200 bg-white p-10 text-center shadow-sm">
          <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-4 border-indigo-200 border-t-indigo-600" />
          <p className="text-sm text-gray-600">This tailoring is still {tailoring.status}.</p>
          <p className="mt-1 text-xs text-gray-400">
            Check back shortly — this page does not auto-refresh.
          </p>
        </div>
      )}
    </div>
  );
}
