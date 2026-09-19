import Link from 'next/link';
import { Show } from '@clerk/nextjs';
import { ArrowRight } from 'lucide-react';

import { Reveal } from './Reveal';

export function FinalCta() {
  return (
    <section className="relative overflow-hidden bg-[#181818] px-6 py-24 text-center text-[#F7F7F7] lg:py-32">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-60"
        style={{
          background:
            'radial-gradient(65% 70% at 50% 100%, rgba(90,95,125,0.22) 0%, rgba(24,24,24,0) 80%), radial-gradient(40% 45% at 50% 100%, rgba(99,102,241,0.18) 0%, rgba(24,24,24,0) 75%)',
        }}
      />
      <Reveal className="relative mx-auto max-w-2xl">
        <h2 className="text-3xl font-extrabold tracking-tight sm:text-4xl lg:text-5xl">
          Ready to land more interviews?
        </h2>
        <p className="mt-4 text-lg text-[#B4B4B4]">
          Start free, no credit card required. Upgrade any time you need unlimited access.
        </p>
        <div className="mt-8 flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
          <Show when="signed-out">
            <Link
              href="/sign-up"
              className="inline-flex items-center gap-2 rounded-full bg-white px-8 py-3.5 text-base font-semibold text-neutral-900 transition-transform hover:scale-[1.02] motion-reduce:hover:scale-100"
            >
              Get started — it&apos;s free
              <ArrowRight className="h-4 w-4" />
            </Link>
          </Show>
          <Show when="signed-in">
            <Link
              href="/dashboard"
              className="inline-flex items-center gap-2 rounded-full bg-white px-8 py-3.5 text-base font-semibold text-neutral-900 transition-transform hover:scale-[1.02] motion-reduce:hover:scale-100"
            >
              Go to dashboard
              <ArrowRight className="h-4 w-4" />
            </Link>
          </Show>
        </div>
      </Reveal>
    </section>
  );
}
