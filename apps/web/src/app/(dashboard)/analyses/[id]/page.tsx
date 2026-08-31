export const dynamic = 'force-dynamic';

import Link from 'next/link';
import { auth } from '@clerk/nextjs/server';
import { notFound, redirect } from 'next/navigation';

import { API_BASE_URL as API_URL } from '@/lib/apiUrl';
import type { AnalysisDto } from '@/lib/analysisApi';
import { AnalysisResults } from '@/components/analysis/AnalysisResults';

async function fetchAnalysis(token: string, id: string): Promise<AnalysisDto | null> {
  const res = await fetch(`${API_URL}/analyses/${id}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Failed to fetch analysis: ${res.status}`);
  return res.json() as Promise<AnalysisDto>;
}

interface Props {
  params: Promise<{ id: string }>;
}

export default async function AnalysisDetailPage({ params }: Props) {
  const { id } = await params;
  const { getToken, userId } = await auth();
  if (!userId) redirect('/sign-in');

  const token = await getToken();
  if (!token) redirect('/sign-in');

  const analysis = await fetchAnalysis(token, id);
  if (!analysis) notFound();

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <div className="mb-6">
        <Link href="/analyses" className="text-sm text-indigo-600 hover:underline">
          ← Analysis history
        </Link>
      </div>

      {analysis.status === 'done' && <AnalysisResults analysis={analysis} />}

      {analysis.status === 'failed' && (
        <div className="mx-auto max-w-3xl rounded-xl border border-red-200 bg-red-50 p-6 text-center">
          <p className="text-sm font-medium text-red-700">This analysis failed to complete.</p>
          <p className="mt-1 text-xs text-red-500">No results were saved for this run.</p>
          <Link
            href="/analyze"
            className="mt-4 inline-block rounded-md bg-indigo-600 px-4 py-2 text-xs font-medium text-white hover:bg-indigo-700"
          >
            Try again
          </Link>
        </div>
      )}

      {(analysis.status === 'pending' || analysis.status === 'processing') && (
        <div className="mx-auto max-w-3xl rounded-xl border border-gray-200 bg-white p-10 text-center shadow-sm">
          <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-4 border-indigo-200 border-t-indigo-600" />
          <p className="text-sm text-gray-600">This analysis is still {analysis.status}.</p>
          <p className="mt-1 text-xs text-gray-400">
            Check back shortly — this page does not auto-refresh.
          </p>
        </div>
      )}
    </div>
  );
}
