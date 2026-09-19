import Link from 'next/link';
import { Show } from '@clerk/nextjs';
import { ArrowRight, Sparkles } from 'lucide-react';

export function Hero() {
  return (
    <section className="relative overflow-hidden bg-[#181818] text-[#F7F7F7]">
      {/* Muted charcoal/slate atmosphere: a wide slate wash plus a mauve
          undertone carry most of the depth now, with indigo/violet kept as
          a restrained accent layer rather than the dominant colour — the
          brand accent should read as deliberate, not as "the whole hero is
          purple." */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(80% 65% at 50% -10%, rgba(90,95,125,0.32) 0%, rgba(24,24,24,0) 75%), radial-gradient(50% 42% at 62% 8%, rgba(99,85,100,0.2) 0%, rgba(24,24,24,0) 80%), radial-gradient(30% 28% at 42% 2%, rgba(99,102,241,0.14) 0%, rgba(24,24,24,0) 78%)',
        }}
      />
      {/* Faint vignette — grounds the edges/corners so the hero reads as one
          considered scene rather than a flat gradient dropped on a box. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(120% 100% at 50% 20%, transparent 45%, rgba(0,0,0,0.35) 100%)',
        }}
      />
      <div className="relative mx-auto max-w-5xl px-6 py-28 text-center sm:py-36 lg:py-44">
        <div className="mx-auto mb-7 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-1.5 text-xs font-medium text-[#F7F7F7]/80">
          <Sparkles className="h-3.5 w-3.5 text-indigo-400" />
          AI-powered CV tools for every career move
        </div>
        <h1 className="text-5xl font-extrabold leading-[1.08] tracking-tight sm:text-6xl md:text-7xl xl:text-[5.5rem]">
          Build a CV designed
          <br />
          <span className="bg-gradient-to-r from-indigo-400 via-violet-400 to-indigo-300 bg-clip-text text-transparent">
            to get you hired.
          </span>
        </h1>
        <p className="mx-auto mt-7 max-w-2xl text-lg leading-relaxed text-[#B4B4B4]">
          Create a CV from scratch or upload an existing one, get an instant AI match score against
          any job description, and generate a tailored cover letter — all in one place.
        </p>

        <div className="mt-11 flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
          <Show when="signed-out">
            <Link
              href="/sign-up"
              className="inline-flex items-center gap-2 rounded-full bg-white px-8 py-3.5 text-base font-semibold text-neutral-900 shadow-[0_8px_30px_-8px_rgba(255,255,255,0.35)] transition-transform hover:scale-[1.02] motion-reduce:hover:scale-100"
            >
              Get started — it&apos;s free
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              href="#how-it-works"
              className="inline-flex items-center gap-2 rounded-full border border-white/15 px-8 py-3.5 text-base font-semibold text-white transition-colors hover:border-white/30 hover:bg-white/5"
            >
              See how it works
            </Link>
          </Show>
          <Show when="signed-in">
            <Link
              href="/dashboard"
              className="inline-flex items-center gap-2 rounded-full bg-white px-8 py-3.5 text-base font-semibold text-neutral-900 shadow-[0_8px_30px_-8px_rgba(255,255,255,0.35)] transition-transform hover:scale-[1.02] motion-reduce:hover:scale-100"
            >
              Go to dashboard
              <ArrowRight className="h-4 w-4" />
            </Link>
          </Show>
        </div>
        <p className="mt-4 text-sm text-[#B4B4B4]/70">No credit card required to start.</p>
      </div>
    </section>
  );
}
