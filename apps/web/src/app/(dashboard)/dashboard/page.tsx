export const dynamic = 'force-dynamic';

import Link from 'next/link';
import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import { FileText, BarChart3, Mail, Plus, Upload, Wand2 } from 'lucide-react';

import { listCvs } from '@/lib/cvApi';
import { listAnalyses } from '@/lib/analysisApi';
import { listCoverLetters } from '@/lib/coverLetterApi';
import { listTailorings } from '@/lib/tailoringApi';
import {
  getSubscription,
  getUsage,
  type SubscriptionDto,
  type UsageSummary,
} from '@/lib/billingApi';
import { BillingSummary } from '@/components/billing/BillingSummary';
import { PlanUsageCard } from '@/components/billing/UsageCard';

function ScoreBadge({ score }: { score: number }) {
  const color =
    score >= 70
      ? 'bg-green-100 text-green-700'
      : score >= 40
        ? 'bg-amber-100 text-amber-700'
        : 'bg-red-100 text-red-700';
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${color}`}
    >
      {score}%
    </span>
  );
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

const SOURCE_LABELS: Record<string, string> = {
  upload: 'Uploaded',
  builder: 'Built',
  prefill: 'Prefilled',
  tailored: 'Tailored',
};

interface Props {
  searchParams: Promise<{ checkout?: string }>;
}

export default async function DashboardPage({ searchParams }: Props) {
  const { checkout } = await searchParams;
  const { getToken, userId } = await auth();
  if (!userId) redirect('/sign-in');

  const token = await getToken();

  const [cvs, analyses, coverLettersRes, tailorings, subscription, usage] = await Promise.all([
    token ? listCvs(token).catch(() => []) : [],
    token ? listAnalyses(token).catch(() => []) : [],
    token
      ? listCoverLetters(token).catch(() => ({ items: [], total: 0, page: 1, limit: 20 }))
      : { items: [], total: 0, page: 1, limit: 20 },
    token ? listTailorings(token).catch(() => []) : [],
    token
      ? getSubscription(token).catch((): SubscriptionDto | null | 'error' => 'error')
      : ('error' as const),
    token ? getUsage(token).catch((): UsageSummary | 'error' => 'error') : ('error' as const),
  ]);

  const recentCvs = cvs.slice(0, 3);
  const recentAnalyses = analyses.filter((a) => a.status === 'done').slice(0, 3);
  const recentLetters = coverLettersRes.items
    .filter((l) => l.status === 'generated' || l.status === 'downloaded')
    .slice(0, 3);
  const recentTailorings = tailorings
    .filter((t) => t.status === 'done' || t.status === 'applied')
    .slice(0, 3);

  const uploadedCvsReady = cvs.filter((c) => c.source === 'upload' && c.parseStatus === 'done');

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      {checkout === 'success' && (
        <div className="mb-6 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
          Payment successful. Your plan will update automatically once Stripe confirms the
          subscription — this usually takes just a few seconds.
        </div>
      )}
      {checkout === 'cancelled' && (
        <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
          Checkout was cancelled. You have not been charged.
        </div>
      )}

      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <p className="mt-1 text-sm text-gray-500">Everything you need to land your next role.</p>
      </div>

      <BillingSummary subscription={subscription} />
      <PlanUsageCard usage={usage} />

      {/* Stats */}
      <div className="mb-8 grid grid-cols-3 gap-4">
        {[
          { label: 'CVs', value: cvs.length, Icon: FileText, href: '/cvs' },
          {
            label: 'Analyses',
            value: analyses.filter((a) => a.status === 'done').length,
            Icon: BarChart3,
            href: '/analyze',
          },
          {
            label: 'Cover letters',
            value: coverLettersRes.total,
            Icon: Mail,
            href: '/cover-letter',
          },
        ].map(({ label, value, Icon, href }) => (
          <Link
            key={label}
            href={href}
            className="flex items-center gap-4 rounded-xl border border-gray-200 bg-white p-5 shadow-sm hover:border-indigo-300 transition-colors"
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-50">
              <Icon className="h-5 w-5 text-indigo-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-900">{value}</p>
              <p className="text-xs text-gray-500">{label}</p>
            </div>
          </Link>
        ))}
      </div>

      {/* Quick actions */}
      <div className="mb-8">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-400">
          Quick actions
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <ActionCard
            href="/cvs/new"
            Icon={Plus}
            title="New CV"
            desc="Start from scratch or use an example"
          />
          <ActionCard
            href="/cvs/new"
            Icon={Upload}
            title="Upload CV"
            desc="Upload PDF or DOCX for AI analysis"
          />
          <ActionCard
            href={uploadedCvsReady.length > 0 ? '/analyze' : '/cvs/new'}
            Icon={BarChart3}
            title="Analyse CV"
            desc="Get a match score against a job description"
          />
          <ActionCard
            href={uploadedCvsReady.length > 0 ? '/cover-letter' : '/cvs/new'}
            Icon={Wand2}
            title="Cover letter"
            desc="Generate a tailored cover letter instantly"
          />
        </div>
      </div>

      {/* Recent CVs */}
      {recentCvs.length > 0 && (
        <section className="mb-8">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-400">
              Recent CVs
            </h2>
            <Link href="/cvs" className="text-xs text-indigo-600 hover:underline">
              View all
            </Link>
          </div>
          <div className="rounded-xl border border-gray-200 bg-white shadow-sm divide-y divide-gray-100">
            {recentCvs.map((cv) => (
              <div key={cv.id} className="flex items-center justify-between px-5 py-3.5">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-gray-900">
                    {cv.title ?? cv.fileName ?? 'Untitled CV'}
                  </p>
                  <p className="text-xs text-gray-400">
                    {SOURCE_LABELS[cv.source] ?? cv.source} · {formatDate(cv.updatedAt)}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2 ml-4">
                  {cv.source !== 'upload' && (
                    <Link
                      href={`/cvs/${cv.id}/tailor`}
                      className="rounded-md px-2.5 py-1 text-xs font-medium text-indigo-600 border border-indigo-200 hover:bg-indigo-50"
                    >
                      Tailor
                    </Link>
                  )}
                  {cv.source !== 'upload' ? (
                    <Link
                      href={`/cvs/${cv.id}/edit`}
                      className="rounded-md bg-indigo-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-indigo-700"
                    >
                      Edit
                    </Link>
                  ) : cv.parseStatus === 'done' ? (
                    <Link
                      href="/analyze"
                      className="rounded-md bg-indigo-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-indigo-700"
                    >
                      Analyse
                    </Link>
                  ) : (
                    <span className="text-xs text-gray-400">Parsing…</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Recent analyses */}
      {recentAnalyses.length > 0 && (
        <section className="mb-8">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-400">
              Recent analyses
            </h2>
            <div className="flex items-center gap-3">
              <Link href="/analyses" className="text-xs text-indigo-600 hover:underline">
                View all
              </Link>
              <Link href="/analyze" className="text-xs text-indigo-600 hover:underline">
                New analysis
              </Link>
            </div>
          </div>
          <div className="rounded-xl border border-gray-200 bg-white shadow-sm divide-y divide-gray-100">
            {recentAnalyses.map((a) => (
              <div key={a.id} className="flex items-center justify-between px-5 py-3.5">
                <Link href={`/analyses/${a.id}`} className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-gray-900">
                    {a.jobTitle ?? 'Untitled role'}
                    {a.companyName ? ` — ${a.companyName}` : ''}
                  </p>
                  <p className="text-xs text-gray-400">{formatDate(a.createdAt)}</p>
                </Link>
                <div className="flex shrink-0 items-center gap-3 ml-4">
                  {a.matchScore != null && <ScoreBadge score={a.matchScore} />}
                  <Link
                    href={`/cover-letter`}
                    className="rounded-md px-2.5 py-1 text-xs font-medium text-indigo-600 border border-indigo-200 hover:bg-indigo-50"
                  >
                    Cover letter
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Recent cover letters */}
      {recentLetters.length > 0 && (
        <section className="mb-8">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-400">
              Recent cover letters
            </h2>
            <div className="flex items-center gap-3">
              <Link href="/cover-letters" className="text-xs text-indigo-600 hover:underline">
                View all
              </Link>
              <Link href="/cover-letter" className="text-xs text-indigo-600 hover:underline">
                New letter
              </Link>
            </div>
          </div>
          <div className="rounded-xl border border-gray-200 bg-white shadow-sm divide-y divide-gray-100">
            {recentLetters.map((l) => (
              <div key={l.id} className="flex items-center justify-between px-5 py-3.5">
                <Link href={`/cover-letters/${l.id}`} className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-gray-900">
                    {l.jobTitle ?? 'Untitled role'}
                    {l.companyName ? ` — ${l.companyName}` : ''}
                  </p>
                  <p className="text-xs text-gray-400 capitalize">
                    {l.tone} · {formatDate(l.createdAt)}
                  </p>
                </Link>
                <Link
                  href="/cover-letter"
                  className="ml-4 rounded-md bg-indigo-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-indigo-700 shrink-0"
                >
                  New letter
                </Link>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Recent tailorings */}
      {recentTailorings.length > 0 && (
        <section className="mb-8">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-400">
              Recent tailorings
            </h2>
            <div className="flex items-center gap-3">
              <Link href="/tailorings" className="text-xs text-indigo-600 hover:underline">
                View all
              </Link>
              <Link href="/cvs" className="text-xs text-indigo-600 hover:underline">
                Tailor a CV
              </Link>
            </div>
          </div>
          <div className="rounded-xl border border-gray-200 bg-white shadow-sm divide-y divide-gray-100">
            {recentTailorings.map((t) => (
              <div key={t.id} className="flex items-center justify-between px-5 py-3.5">
                <Link href={`/tailorings/${t.id}`} className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-gray-900">
                    {t.jobTitle ?? 'Untitled role'}
                    {t.companyName ? ` — ${t.companyName}` : ''}
                  </p>
                  <p className="text-xs text-gray-400">{formatDate(t.createdAt)}</p>
                </Link>
                <span
                  className={`ml-4 inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-semibold ${
                    t.status === 'applied'
                      ? 'bg-green-100 text-green-700'
                      : 'bg-amber-100 text-amber-700'
                  }`}
                >
                  {t.status === 'applied' ? 'Applied' : 'Ready to review'}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Empty state */}
      {cvs.length === 0 && (
        <div className="rounded-xl border-2 border-dashed border-gray-200 bg-white py-16 text-center">
          <p className="text-gray-400 text-sm">You have no CVs yet.</p>
          <Link
            href="/cvs/new"
            className="mt-4 inline-block rounded-lg bg-indigo-600 px-5 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
          >
            Create your first CV
          </Link>
        </div>
      )}
    </div>
  );
}

function ActionCard({
  href,
  Icon,
  title,
  desc,
}: {
  href: string;
  Icon: React.ComponentType<{ className?: string }>;
  title: string;
  desc: string;
}) {
  return (
    <Link
      href={href}
      className="flex flex-col gap-2 rounded-xl border border-gray-200 bg-white p-4 shadow-sm hover:border-indigo-300 hover:shadow-md transition-all"
    >
      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-50">
        <Icon className="h-4 w-4 text-indigo-600" />
      </div>
      <p className="text-sm font-semibold text-gray-900">{title}</p>
      <p className="text-xs text-gray-500">{desc}</p>
    </Link>
  );
}
