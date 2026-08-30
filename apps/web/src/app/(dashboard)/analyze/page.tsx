export const dynamic = 'force-dynamic';

import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';

import { listCvs } from '@/lib/cvApi';
import { AnalysisWorkspace } from '@/components/analysis/AnalysisWorkspace';

export default async function AnalyzePage() {
  const { getToken, userId } = await auth();
  if (!userId) redirect('/sign-in');

  const token = await getToken();
  const cvs = token ? await listCvs(token).catch(() => []) : [];

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Analyse CV</h1>
        <p className="mt-1 text-sm text-gray-500">
          Get an AI-powered match score and keyword analysis against a job description.
        </p>
      </div>
      <AnalysisWorkspace initialCvs={cvs} />
    </div>
  );
}
