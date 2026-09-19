import { AlertCircle, CheckCircle2, Sparkles } from 'lucide-react';

import { Reveal } from './Reveal';

// A CSS-built illustrative mockup — deliberately not a real product
// screenshot. RABBIT_NOTEBOOK.md's "add product screenshots" checklist item
// still needs genuine captured screenshots of the running app; this fills
// the same visual slot for now without claiming to be a real capture.
const ATS_CHECKS = [
  { label: 'Standard section headings', ok: true },
  { label: 'No tables or text boxes', ok: true },
  { label: 'Contact details detected', ok: true },
  { label: 'Missing keyword: "stakeholder management"', ok: false },
] as const;

export function ProductShowcase() {
  return (
    <section className="relative overflow-hidden bg-[#FCFCFD] px-6 py-24 lg:py-28">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(60% 55% at 50% 100%, rgba(99,102,241,0.06) 0%, rgba(252,252,253,0) 70%)',
        }}
      />
      <div className="relative mx-auto max-w-6xl">
        <Reveal className="mx-auto max-w-2xl text-center">
          <p className="text-xs font-semibold uppercase tracking-widest text-indigo-600">
            See it in action
          </p>
          <h2 className="mt-3 text-3xl font-extrabold tracking-tight text-neutral-900 sm:text-4xl lg:text-5xl">
            From upload to tailored CV, instantly.
          </h2>
          <p className="mt-4 text-neutral-500">
            A structured CV preview, live AI suggestions, and a real-time match score against the
            role you&apos;re applying for — side by side.
          </p>
        </Reveal>

        <Reveal
          delayMs={100}
          className="relative mt-16 rounded-[2rem] border border-neutral-200 bg-gradient-to-b from-neutral-50 to-white p-4 shadow-[0_1px_2px_rgba(15,15,20,0.04),0_30px_60px_-20px_rgba(15,15,20,0.18)] sm:p-8"
        >
          <div className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
            {/* Mock CV preview, with a floating AI-suggestion callout */}
            <div className="relative rounded-2xl border border-neutral-200 bg-white p-7 sm:p-8">
              <div className="flex items-center gap-3 border-b border-neutral-100 pb-5">
                <div className="h-11 w-11 rounded-full bg-neutral-200" />
                <div>
                  <div className="h-2.5 w-32 rounded bg-neutral-300" />
                  <div className="mt-2 h-2 w-24 rounded bg-neutral-200" />
                </div>
              </div>

              <div className="mt-6 space-y-3">
                <div className="h-2 w-28 rounded bg-indigo-200" />
                <div className="h-2 w-full rounded bg-neutral-100" />
                <div className="h-2 w-5/6 rounded bg-neutral-100" />
                <div className="relative h-2 w-4/6 rounded bg-indigo-100">
                  <span className="absolute -right-1 -top-1 h-3 w-3 rounded-full border-2 border-white bg-indigo-500" />
                </div>
              </div>

              {/* Floating suggestion chip — illustrates the AI-editing panel
                  without pretending to be a real, functioning UI capture. */}
              <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-indigo-100 bg-indigo-50/70 p-3.5 text-left">
                <Sparkles className="mt-0.5 h-4 w-4 flex-shrink-0 text-indigo-500" />
                <p className="text-xs leading-relaxed text-indigo-900">
                  <span className="font-semibold">AI suggestion:</span> Quantify this achievement —
                  add a measurable result to strengthen impact.
                </p>
              </div>

              <div className="mt-6 space-y-3">
                <div className="h-2 w-36 rounded bg-indigo-200" />
                <div className="h-2 w-full rounded bg-neutral-100" />
                <div className="h-2 w-3/6 rounded bg-neutral-100" />
              </div>
            </div>

            {/* Right column: match score + ATS checklist */}
            <div className="flex flex-col gap-6">
              <div className="flex flex-col justify-between rounded-2xl border border-neutral-200 bg-neutral-950 p-7">
                <p className="text-xs font-medium uppercase tracking-widest text-neutral-400">
                  Match score
                </p>
                <div className="mt-3 flex items-end gap-2">
                  <span className="text-6xl font-extrabold text-white">87</span>
                  <span className="mb-2 text-lg text-neutral-400">/ 100</span>
                </div>
                <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-white/10">
                  <div className="h-full w-[87%] rounded-full bg-gradient-to-r from-indigo-500 to-violet-400" />
                </div>
                <div className="mt-5 space-y-2.5">
                  {['Leadership', 'Data analysis', 'Stakeholder management'].map((kw) => (
                    <div key={kw} className="flex items-center gap-2 text-sm text-neutral-300">
                      <CheckCircle2 className="h-4 w-4 flex-shrink-0 text-indigo-400" />
                      {kw} matched
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-2xl border border-neutral-200 bg-white p-6">
                <p className="text-xs font-semibold uppercase tracking-widest text-neutral-500">
                  ATS check
                </p>
                <div className="mt-4 space-y-2.5">
                  {ATS_CHECKS.map((check) => (
                    <div key={check.label} className="flex items-start gap-2 text-sm">
                      {check.ok ? (
                        <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0 text-emerald-500" />
                      ) : (
                        <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-500" />
                      )}
                      <span className={check.ok ? 'text-neutral-600' : 'text-neutral-900'}>
                        {check.label}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </Reveal>
        <p className="mt-4 text-center text-xs text-neutral-400">
          Illustrative product preview — not a live screenshot.
        </p>
      </div>
    </section>
  );
}
