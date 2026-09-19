import { ArrowRight } from 'lucide-react';

import { Reveal } from './Reveal';

// Illustrative example only — explicitly labelled as such below, never
// presented as a real statistic about CVPilot users (see RABBIT_NOTEBOOK.md:
// never fabricate stats/claims).
export function AtsVisual() {
  return (
    <section className="relative overflow-hidden bg-[#181818] px-6 py-24 text-[#F7F7F7] lg:py-28">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-70"
        style={{
          background:
            'radial-gradient(70% 60% at 50% 40%, rgba(90,95,125,0.2) 0%, rgba(24,24,24,0) 80%), radial-gradient(45% 35% at 30% 75%, rgba(99,85,100,0.14) 0%, rgba(24,24,24,0) 80%)',
        }}
      />
      <div className="relative mx-auto max-w-6xl">
        <Reveal className="mx-auto max-w-2xl text-center">
          <p className="text-xs font-semibold uppercase tracking-widest text-indigo-400">
            Built to pass the filters
          </p>
          <h2 className="mt-3 text-3xl font-extrabold tracking-tight sm:text-4xl lg:text-5xl">
            See your CV the way an ATS does.
          </h2>
          <p className="mt-4 text-lg text-[#B4B4B4]">
            CVPilot highlights missing keywords and formatting issues, then helps you fix them —
            before a recruiter ever opens your CV.
          </p>
        </Reveal>

        <Reveal
          delayMs={100}
          className="mx-auto mt-16 grid max-w-3xl items-center gap-8 sm:grid-cols-[1fr_auto_1fr]"
        >
          <div className="rounded-2xl border border-white/10 bg-[#262626]/70 p-8 text-center">
            <p className="text-xs font-medium uppercase tracking-widest text-[#B4B4B4]/70">
              Before
            </p>
            <p className="mt-4 text-5xl font-extrabold text-[#B4B4B4]">46</p>
            <p className="mt-1.5 text-sm text-[#B4B4B4]/70">Generic CV</p>
          </div>
          <ArrowRight
            aria-hidden="true"
            className="mx-auto h-6 w-6 rotate-90 text-indigo-400 sm:rotate-0"
          />
          <div className="rounded-2xl border border-indigo-500/30 bg-indigo-500/10 p-8 text-center shadow-[0_20px_40px_-20px_rgba(99,102,241,0.5)]">
            <p className="text-xs font-medium uppercase tracking-widest text-indigo-300">
              After CVPilot
            </p>
            <p className="mt-4 text-5xl font-extrabold text-white">89</p>
            <p className="mt-1.5 text-sm text-indigo-300">Tailored with AI suggestions</p>
          </div>
        </Reveal>
        <p className="mx-auto mt-6 max-w-md text-center text-xs text-[#B4B4B4]/50">
          Illustrative example — your actual score depends on your CV and the job description.
        </p>
      </div>
    </section>
  );
}
