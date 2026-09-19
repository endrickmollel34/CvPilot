'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ChevronDown } from 'lucide-react';

import { Reveal } from './Reveal';

// Every answer here is deliberately grounded in what Terms/Privacy already
// state — none of this invents a policy that isn't already approved
// elsewhere (see apps/web/src/app/terms/page.tsx and privacy/page.tsx).
const FAQS = [
  {
    q: 'Is CVPilot free to use?',
    a: 'Yes. The Free plan lets you try CVPilot with 2 CV analyses and 1 cover letter per month, with PDF and DOCX support — no credit card required.',
  },
  {
    q: 'How does 7-Day Pro Access work?',
    a: 'You pay €2.99 upfront for 7 days of full Pro access. Unless you cancel before the 7-day period ends, your subscription automatically renews at €14.99/month. You can cancel at any time from Billing — if you cancel during the initial 7 days, you keep Pro access for the rest of that period and are not charged again.',
  },
  {
    q: 'Can I cancel anytime?',
    a: 'Yes. You can manage or cancel your subscription at any time from the billing portal in your dashboard.',
  },
  {
    q: 'What file formats does CVPilot support?',
    a: 'You can upload an existing CV as a PDF or DOCX file, or build one from scratch with the CV builder. Generated CVs are downloadable as PDF.',
  },
  {
    q: 'Is my CV data private?',
    a: 'Your uploaded files are stored securely and only ever served through short-lived, private links — never made public. See our Privacy Policy for full details on how your data is handled.',
  },
  {
    q: 'Do you offer refunds?',
    a: 'We do not currently offer prorated refunds for partial billing periods, except where required by law. Full details are in our Terms of Service.',
  },
] as const;

export function Faq() {
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  return (
    <section
      id="faq"
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
      <Reveal className="relative mx-auto max-w-6xl">
        <div className="grid gap-12 lg:grid-cols-[0.8fr_1.2fr] lg:items-start lg:gap-16">
          <div className="lg:sticky lg:top-28">
            <p className="text-xs font-semibold uppercase tracking-widest text-indigo-600">FAQ</p>
            <h2 className="mt-3 text-3xl font-extrabold tracking-tight text-neutral-900 sm:text-4xl lg:text-5xl">
              Frequently asked questions
            </h2>
            <p className="mt-5 max-w-sm text-base leading-relaxed text-neutral-500">
              Can&apos;t find what you&apos;re looking for?{' '}
              <Link href="/contact" className="font-medium text-indigo-600 hover:underline">
                Get in touch
              </Link>
              .
            </p>
          </div>

          <div className="divide-y divide-neutral-200 rounded-3xl border border-neutral-200 bg-white shadow-[0_1px_2px_rgba(15,15,20,0.03),0_16px_32px_-16px_rgba(15,15,20,0.1)]">
            {FAQS.map((item, i) => {
              const isOpen = openIndex === i;
              return (
                <div key={item.q}>
                  <button
                    type="button"
                    onClick={() => setOpenIndex(isOpen ? null : i)}
                    className="flex w-full items-center justify-between gap-4 px-7 py-6 text-left transition-colors hover:bg-neutral-50/80"
                    aria-expanded={isOpen}
                    aria-controls={`faq-panel-${i}`}
                  >
                    <span className="text-[15px] font-medium text-neutral-900">{item.q}</span>
                    <span
                      className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full transition-colors ${
                        isOpen ? 'bg-indigo-600 text-white' : 'bg-neutral-100 text-neutral-500'
                      }`}
                    >
                      <ChevronDown
                        aria-hidden="true"
                        className={`h-4 w-4 transition-transform duration-300 ${
                          isOpen ? 'rotate-180' : ''
                        }`}
                      />
                    </span>
                  </button>
                  {isOpen && (
                    <div
                      id={`faq-panel-${i}`}
                      className="border-l-2 border-indigo-500 px-7 pb-6 text-sm leading-relaxed text-neutral-500"
                    >
                      {item.a}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </Reveal>
    </section>
  );
}
