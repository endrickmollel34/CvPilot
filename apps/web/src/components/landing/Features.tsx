import { FileText, LayoutTemplate, Mail, Target, Upload, Wand2 } from 'lucide-react';

import { Reveal } from './Reveal';

// Every entry here names an already-implemented CVPilot feature — no
// aspirational/roadmap items (those live in RABBIT_NOTEBOOK.md §4 instead).
// `featured` gives the flagship entry a distinct, larger treatment in the
// grid below — restrained visual variation, not a different content set.
const FEATURES = [
  {
    Icon: LayoutTemplate,
    title: 'CV Builder',
    body: 'Build a structured, professional CV from scratch with clean, ATS-friendly templates — the fastest way to a polished CV.',
    featured: true,
  },
  {
    Icon: Upload,
    title: 'Upload & parse',
    body: 'Upload an existing PDF or DOCX CV — we extract your details automatically.',
    featured: false,
  },
  {
    Icon: Target,
    title: 'AI match score',
    body: 'See exactly how well your CV matches a job description, with specific, actionable feedback.',
    featured: false,
  },
  {
    Icon: Wand2,
    title: 'AI-tailored CVs',
    body: 'Generate a version of your CV tailored to a specific role in one click.',
    featured: false,
  },
  {
    Icon: Mail,
    title: 'Cover letters',
    body: 'Generate a personalised cover letter for any job, ready to send.',
    featured: false,
  },
  {
    Icon: FileText,
    title: 'PDF export',
    body: 'Download a polished, ready-to-send document whenever you need it.',
    featured: false,
  },
] as const;

export function Features() {
  return (
    <section
      id="features"
      className="relative scroll-mt-24 overflow-hidden bg-neutral-50 px-6 py-24 lg:py-28"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(60% 50% at 50% 0%, rgba(99,102,241,0.06) 0%, rgba(250,250,250,0) 70%)',
        }}
      />
      <div className="relative mx-auto max-w-6xl">
        <Reveal className="mx-auto max-w-2xl text-center">
          <p className="text-xs font-semibold uppercase tracking-widest text-indigo-600">
            Features
          </p>
          <h2 className="mt-3 text-3xl font-extrabold tracking-tight text-neutral-900 sm:text-4xl lg:text-5xl">
            Everything you need to apply with confidence.
          </h2>
        </Reveal>

        <Reveal delayMs={100} className="mt-16 grid gap-6 sm:grid-cols-2 lg:grid-cols-3 lg:gap-6">
          {FEATURES.map(({ Icon, title, body, featured }) => (
            <div
              key={title}
              className={`group relative flex flex-col rounded-2xl border p-7 transition-all duration-300 hover:-translate-y-1 motion-reduce:hover:translate-y-0 ${
                featured
                  ? 'sm:col-span-2 lg:col-span-2 sm:flex-row sm:items-start sm:gap-6 border-indigo-200/70 bg-gradient-to-br from-indigo-50 via-white to-white shadow-[0_1px_2px_rgba(79,70,229,0.06),0_16px_32px_-16px_rgba(79,70,229,0.25)] hover:shadow-[0_1px_2px_rgba(79,70,229,0.08),0_20px_40px_-16px_rgba(79,70,229,0.3)]'
                  : 'border-neutral-200/80 bg-white shadow-[0_1px_2px_rgba(15,15,20,0.03),0_10px_24px_-12px_rgba(15,15,20,0.08)] hover:border-indigo-200/70 hover:shadow-[0_1px_2px_rgba(15,15,20,0.04),0_16px_32px_-16px_rgba(79,70,229,0.16)]'
              }`}
            >
              <div
                className={`flex flex-shrink-0 items-center justify-center rounded-xl ring-1 transition-colors ${
                  featured
                    ? 'h-14 w-14 bg-gradient-to-br from-indigo-600 to-violet-600 text-white shadow-lg shadow-indigo-600/25 ring-transparent'
                    : 'h-11 w-11 bg-indigo-50 text-indigo-600 ring-indigo-100 group-hover:bg-indigo-100'
                }`}
              >
                <Icon className={featured ? 'h-6 w-6' : 'h-5 w-5'} />
              </div>
              <div className={featured ? 'mt-5 sm:mt-0' : 'mt-5'}>
                <h3
                  className={`font-semibold text-neutral-900 ${featured ? 'text-xl' : 'text-base'}`}
                >
                  {title}
                </h3>
                <p className="mt-2.5 text-sm leading-relaxed text-neutral-500">{body}</p>
              </div>
            </div>
          ))}
        </Reveal>
      </div>
    </section>
  );
}
