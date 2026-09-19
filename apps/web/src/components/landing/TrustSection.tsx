import { Clock, Lock, Sparkles, Wallet } from 'lucide-react';

import { Reveal } from './Reveal';

// Genuine, verifiable product facts only — deliberately no user counts,
// ratings, or "as seen in" logos. See RABBIT_NOTEBOOK.md: never fabricate
// testimonials/stats. A real Reviews section is intentionally omitted from
// this homepage entirely until genuine reviews exist.
const POINTS = [
  {
    Icon: Sparkles,
    title: 'Real AI, not templates',
    body: 'Every match score, suggestion, and cover letter is generated fresh from your CV and the job description.',
  },
  {
    Icon: Lock,
    title: 'Privacy-first by design',
    body: 'Uploaded files are stored securely and served only through short-lived, private links — never made public.',
  },
  {
    Icon: Clock,
    title: 'Minutes, not hours',
    body: 'Upload once, get a match score and a tailored cover letter in the time it takes to make coffee.',
  },
  {
    Icon: Wallet,
    title: 'Start free, no card required',
    body: 'Try the Free plan with no commitment. Upgrade only when you need unlimited access.',
  },
];

export function TrustSection() {
  return (
    <section className="relative overflow-hidden border-b border-neutral-200/60 bg-[#FCFCFD] px-6 py-20 lg:py-24">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(60% 60% at 50% 0%, rgba(99,102,241,0.06) 0%, rgba(252,252,253,0) 70%)',
        }}
      />
      <Reveal className="relative mx-auto grid max-w-6xl gap-5 sm:grid-cols-2 lg:grid-cols-4 lg:gap-6">
        {POINTS.map(({ Icon, title, body }) => (
          <div
            key={title}
            className="rounded-2xl border border-neutral-200/70 bg-white p-6 text-center shadow-[0_1px_2px_rgba(15,15,20,0.03),0_10px_24px_-12px_rgba(15,15,20,0.08)] sm:text-left"
          >
            <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 ring-1 ring-indigo-100 sm:mx-0">
              <Icon className="h-5 w-5" />
            </div>
            <h3 className="mt-4 text-sm font-semibold text-neutral-900">{title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-neutral-500">{body}</p>
          </div>
        ))}
      </Reveal>
    </section>
  );
}
