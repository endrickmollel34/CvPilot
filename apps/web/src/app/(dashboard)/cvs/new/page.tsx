export const dynamic = 'force-dynamic';

import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';

import { getUsage } from '@/lib/billingApi';
import { NewCvChooser } from '@/components/cv/NewCvChooser';

export default async function NewCvPage() {
  const { getToken, userId } = await auth();
  if (!userId) redirect('/sign-in');

  const token = await getToken();
  const usage = token ? await getUsage(token).catch(() => null) : null;

  return <NewCvChooser usage={usage?.usage.builderCvs} />;
}
