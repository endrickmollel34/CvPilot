import Link from 'next/link';

import type { UsageCounter, UsageSummary } from '@/lib/billingApi';

function UsageRow({ label, counter }: { label: string; counter: UsageCounter }) {
  if (counter.limit === null) {
    return (
      <div className="flex items-center justify-between py-2">
        <span className="text-sm text-gray-600">{label}</span>
        <span className="text-sm font-medium text-gray-900">Unlimited</span>
      </div>
    );
  }

  const atLimit = counter.remaining === 0;
  const pct =
    counter.limit === 0 ? 100 : Math.min(100, Math.round((counter.used / counter.limit) * 100));

  return (
    <div className="py-2">
      <div className="flex items-center justify-between">
        <span className="text-sm text-gray-600">{label}</span>
        <span className={`text-sm font-medium ${atLimit ? 'text-amber-600' : 'text-gray-900'}`}>
          {counter.used} of {counter.limit} used
        </span>
      </div>
      <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
        <div
          className={`h-full rounded-full ${atLimit ? 'bg-amber-400' : 'bg-indigo-500'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

// Tailoring is gated entirely on Free (limit 0), not a "used so far"
// resource — "0 of 0 used" would be a confusing progress bar, so it gets
// its own copy rather than reusing UsageRow's generic phrasing.
function TailoringUsageRow({ counter }: { counter: UsageCounter }) {
  return (
    <div className="flex items-center justify-between py-2">
      <span className="text-sm text-gray-600">Tailoring</span>
      <span className="text-sm font-medium text-gray-900">
        {counter.limit === null ? 'Unlimited' : 'Available on Pro'}
      </span>
    </div>
  );
}

interface PlanUsageCardProps {
  // 'error' mirrors BillingSummary's convention — a transient fetch failure
  // is kept distinct from "no data" so it's never mistaken for zero usage.
  usage: UsageSummary | 'error';
}

export function PlanUsageCard({ usage }: PlanUsageCardProps) {
  if (usage === 'error') return null;

  const { analyses, coverLetters, tailorings, builderCvs } = usage.usage;
  const atAnyLimit = [analyses, coverLetters, builderCvs].some((c) => c.remaining === 0);

  return (
    <section className="mb-8 rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="mb-1 flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-400">Plan usage</h2>
        {atAnyLimit && (
          <Link href="/#pricing" className="text-xs font-medium text-indigo-600 hover:underline">
            Upgrade
          </Link>
        )}
      </div>
      <div className="divide-y divide-gray-100">
        <UsageRow label="Analyses" counter={analyses} />
        <UsageRow label="Cover letters" counter={coverLetters} />
        <UsageRow label="CV builder" counter={builderCvs} />
        <TailoringUsageRow counter={tailorings} />
      </div>
    </section>
  );
}

interface UsageHintProps {
  counter: UsageCounter;
  /** e.g. "analyses", "cover letters", "CV" */
  unit: string;
  /** e.g. "this month" */
  suffix?: string;
}

/** Small, subtle inline usage hint for creation/workspace screens. */
export function UsageHint({ counter, unit, suffix }: UsageHintProps) {
  if (counter.limit === null) {
    return <p className="text-xs text-gray-400">Unlimited {unit} on your plan.</p>;
  }

  const atLimit = counter.remaining === 0;
  return (
    <p className={`text-xs ${atLimit ? 'text-amber-600' : 'text-gray-400'}`}>
      {counter.used} of {counter.limit} {unit} used{suffix ? ` ${suffix}` : ''}
      {atLimit && (
        <>
          {' · '}
          <Link href="/#pricing" className="font-medium underline">
            Upgrade
          </Link>
        </>
      )}
    </p>
  );
}
