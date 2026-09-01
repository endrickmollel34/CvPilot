import Link from 'next/link';

import type { SubscriptionDto } from '@/lib/billingApi';
import { ManageBillingButton } from './ManageBillingButton';
import { resolvePeriodLabel } from './billingLabels';

const PLAN_LABELS: Record<string, string> = {
  free: 'Free',
  pro: 'Pro',
  student: 'Student',
};

const STATUS_LABELS: Record<string, string> = {
  active: 'Active',
  trialing: 'Trial',
  past_due: 'Past due',
  cancelled: 'Cancelled',
  incomplete: 'Incomplete',
};

const STATUS_COLORS: Record<string, string> = {
  active: 'bg-green-100 text-green-700',
  trialing: 'bg-indigo-100 text-indigo-700',
  past_due: 'bg-amber-100 text-amber-700',
  cancelled: 'bg-gray-100 text-gray-600',
  incomplete: 'bg-amber-100 text-amber-700',
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

interface Props {
  // 'error' means the subscription fetch failed — kept distinct from `null`
  // (no subscription row, i.e. genuinely on the Free plan) so a transient
  // API error is never mistaken for "you're on the Free plan".
  subscription: SubscriptionDto | null | 'error';
}

export function BillingSummary({ subscription }: Props) {
  if (subscription === 'error') {
    return (
      <section className="mb-8 rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <h2 className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-400">
          Billing
        </h2>
        <p className="text-sm text-gray-500">
          Couldn&apos;t load your subscription right now. Your plan and access are unaffected —
          please refresh in a moment.
        </p>
      </section>
    );
  }

  if (!subscription || subscription.plan === 'free') {
    return (
      <section className="mb-8 flex items-center justify-between rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-400">Billing</h2>
          <p className="mt-1 text-base font-semibold text-gray-900">Current plan: Free</p>
        </div>
        <Link
          href="/#pricing"
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
        >
          Upgrade
        </Link>
      </section>
    );
  }

  const { plan, status, currentPeriodEnd, cancelAtPeriodEnd } = subscription;
  const renewalLabel = resolvePeriodLabel(cancelAtPeriodEnd);

  return (
    <section className="mb-8 flex items-center justify-between rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <div>
        <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-400">Billing</h2>
        <div className="mt-1 flex items-center gap-2">
          <p className="text-base font-semibold text-gray-900">
            Current plan: {PLAN_LABELS[plan] ?? plan}
          </p>
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[status] ?? 'bg-gray-100 text-gray-600'}`}
          >
            {STATUS_LABELS[status] ?? status}
          </span>
        </div>
        {currentPeriodEnd && (
          <p className="mt-1 text-xs text-gray-400">
            {renewalLabel} {formatDate(currentPeriodEnd)}
          </p>
        )}
      </div>
      <ManageBillingButton />
    </section>
  );
}
