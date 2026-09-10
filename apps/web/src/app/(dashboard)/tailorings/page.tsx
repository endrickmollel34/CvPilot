export const dynamic = 'force-dynamic';

import Link from 'next/link';
import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';

import { listTailorings } from '@/lib/tailoringApi';
import { TailoringHistoryList } from '@/components/tailoring/TailoringHistoryList';

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

      <TailoringHistoryList initialItems={sorted} />
    </div>
  );
}
