export const dynamic = 'force-dynamic';

import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';

import { NewCvUpload } from '@/components/cv/NewCvUpload';

export default async function NewCvUploadPage() {
  const { userId } = await auth();
  if (!userId) redirect('/sign-in');

  return <NewCvUpload />;
}
