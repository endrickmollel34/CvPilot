export const dynamic = 'force-dynamic';

import Link from 'next/link';
import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';

import { listCvs } from '@/lib/cvApi';
import { CvCard } from '@/components/cv/CvCard';

export default async function CvsPage() {
  const { getToken, userId } = await auth();
  if (!userId) redirect('/sign-in');

  const token = await getToken();
  const cvs = token ? await listCvs(token) : [];

  return (
    <main className="mx-auto max-w-4xl p-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">My CVs</h1>
          <p className="mt-1 text-sm text-gray-500">
            {cvs.length === 0
              ? 'Create your first CV to get started.'
              : `${cvs.length} CV${cvs.length === 1 ? '' : 's'}`}
          </p>
        </div>
        <Link
          href="/cvs/new"
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
        >
          + Create CV
        </Link>
      </div>

      {cvs.length === 0 ? (
        <div className="flex flex-col items-center rounded-xl border-2 border-dashed border-gray-200 py-16 text-center">
          <p className="text-gray-400">No CVs yet.</p>
          <Link
            href="/cvs/new"
            className="mt-4 rounded-lg bg-indigo-600 px-5 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
          >
            Create your first CV
          </Link>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {cvs.map((cv) => (
            <CvCard key={cv.id} cv={cv} />
          ))}
        </div>
      )}
    </main>
  );
}
