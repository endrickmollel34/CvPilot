export const dynamic = 'force-dynamic';

import Link from 'next/link';
import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';

import { listAnalyses } from '@/lib/analysisApi';
import { AnalysisHistoryList } from '@/components/analysis/AnalysisHistoryList';

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

      <AnalysisHistoryList initialItems={sorted} />
    </div>
  );
}
