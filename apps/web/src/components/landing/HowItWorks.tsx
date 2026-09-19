import { BarChart3, ClipboardList, Upload } from 'lucide-react';

import { Reveal } from './Reveal';

const STEPS = [
  {
    Icon: Upload,
    number: '01',
    title: 'Upload or build your CV',
    body: 'PDF or DOCX — we parse it automatically. Or start from scratch with the CV builder.',
  },
  {
    Icon: ClipboardList,
    number: '02',
    title: 'Paste the job description',
    body: 'Any role, any company, any sector. Just paste the listing and go.',
  },
  {
    Icon: BarChart3,
    number: '03',
    title: 'Get your score and fix it',
    body: 'An AI match score, specific suggestions, and a tailored cover letter in one click.',
  },
] as const;

export function HowItWorks() {
  return (
    <section
      id="how-it-works"
      className="relative scroll-mt-24 overflow-hidden bg-neutral-50 px-6 py-24 lg:py-28"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(55% 55% at 50% 0%, rgba(99,102,241,0.05) 0%, rgba(250,250,250,0) 70%)',
        }}
      />
      <div className="relative mx-auto max-w-6xl">
        <Reveal className="mx-auto max-w-2xl text-center">
          <p className="text-xs font-semibold uppercase tracking-widest text-indigo-600">
            How it works
          </p>
          <h2 className="mt-3 text-3xl font-extrabold tracking-tight text-neutral-900 sm:text-4xl lg:text-5xl">
            Three steps. Under a minute.
          </h2>
        </Reveal>

        <Reveal delayMs={100} className="mt-16 grid gap-6 md:grid-cols-3 lg:gap-8">
          {STEPS.map(({ Icon, number, title, body }) => (
            <div
              key={number}
              className="rounded-2xl border border-neutral-200/80 bg-white p-8 shadow-[0_1px_2px_rgba(15,15,20,0.03),0_10px_24px_-12px_rgba(15,15,20,0.08)]"
            >
              <div className="flex items-center gap-4">
                <span className="text-4xl font-extrabold text-neutral-200">{number}</span>
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-600 to-violet-600 text-white shadow-lg shadow-indigo-600/20">
                  <Icon className="h-5 w-5" />
                </div>
              </div>
              <h3 className="mt-6 text-lg font-semibold text-neutral-900">{title}</h3>
              <p className="mt-2.5 text-sm leading-relaxed text-neutral-500">{body}</p>
            </div>
          ))}
        </Reveal>
      </div>
    </section>
  );
}
