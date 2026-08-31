export const dynamic = 'force-dynamic';

import Link from 'next/link';
import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';

import { listCvs } from '@/lib/cvApi';
import { getUsage } from '@/lib/billingApi';
import { CoverLetterWorkspace } from '@/components/cover-letter/CoverLetterWorkspace';

export default async function CoverLetterPage() {
  const { getToken, userId } = await auth();
  if (!userId) redirect('/sign-in');

  const token = await getToken();
  const cvs = token ? await listCvs(token).catch(() => []) : [];
  const usage = token ? await getUsage(token).catch(() => null) : null;

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <div className="mb-8 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Cover Letter</h1>
          <p className="mt-1 text-sm text-gray-500">
            Generate a tailored cover letter from your CV and a job description, then edit and
            download.
          </p>
        </div>
        <Link href="/cover-letters" className="shrink-0 text-sm text-indigo-600 hover:underline">
          Previous letters →
        </Link>
      </div>
      <CoverLetterWorkspace initialCvs={cvs} usage={usage?.usage.coverLetters} />
    </div>
  );
}
