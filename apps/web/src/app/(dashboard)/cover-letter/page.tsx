export const dynamic = 'force-dynamic';

import Link from 'next/link';
import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';

import { listCvs } from '@/lib/cvApi';
import { getUsage } from '@/lib/billingApi';
import { getAnalysis } from '@/lib/analysisApi';
import { CoverLetterWorkspace } from '@/components/cover-letter/CoverLetterWorkspace';

interface Props {
  searchParams: Promise<{ analysisId?: string }>;
}

export default async function CoverLetterPage({ searchParams }: Props) {
  const { getToken, userId } = await auth();
  if (!userId) redirect('/sign-in');

  const token = await getToken();
  const cvs = token ? await listCvs(token).catch(() => []) : [];
  const usage = token ? await getUsage(token).catch(() => null) : null;

  // Analysis → Cover Letter handoff: when arriving from an analysis via
  // AnalysisResults.tsx's "Generate cover letter" link, carry the CV, job
  // title, company name, and job description forward so the user never
  // has to re-enter information CVPilot already has on file. A failed/
  // missing analysis fetch (deleted, not owned, etc.) silently falls back
  // to a normal blank /cover-letter — never blocks the page.
  const { analysisId } = await searchParams;
  const analysis =
    token && analysisId ? await getAnalysis(token, analysisId).catch(() => null) : null;

  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center justify-between border-b border-gray-200 bg-white px-4 py-3">
        <div>
          <h1 className="font-semibold text-gray-900">Cover Letter</h1>
          <p className="text-xs text-gray-500">
            Generate a tailored cover letter from your CV and a job description.
          </p>
        </div>
        <Link href="/cover-letters" className="shrink-0 text-sm text-indigo-600 hover:underline">
          Previous letters →
        </Link>
      </header>

      <CoverLetterWorkspace
        initialCvs={cvs}
        usage={usage?.usage.coverLetters}
        prefill={
          analysis
            ? {
                analysisId: analysis.id,
                cvId: analysis.cvId,
                jobTitle: analysis.jobTitle,
                companyName: analysis.companyName,
                jobDescription: analysis.jobDescription,
              }
            : undefined
        }
      />
    </div>
  );
}
