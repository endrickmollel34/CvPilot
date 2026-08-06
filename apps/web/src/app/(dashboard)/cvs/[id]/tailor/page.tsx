import Link from 'next/link';
import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';

import { TailoringWorkspace } from '@/components/tailoring/TailoringWorkspace';

export const metadata = { title: 'Tailor CV for Job — CVPilot' };

interface Props {
  params: Promise<{ id: string }>;
}

export default async function TailorPage({ params }: Props) {
  const { id } = await params;
  const { userId } = await auth();
  if (!userId) redirect('/sign-in');

  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center gap-4 border-b border-gray-200 bg-white px-4 py-3">
        <Link href="/cvs" className="text-sm text-indigo-600 hover:underline">
          ← My CVs
        </Link>
        <h1 className="font-semibold text-gray-900">Tailor for job</h1>
      </header>
      <div className="flex-1 overflow-y-auto">
        <TailoringWorkspace masterCvId={id} />
      </div>
    </div>
  );
}
