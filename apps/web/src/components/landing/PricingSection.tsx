import Link from 'next/link';
import { Check } from 'lucide-react';

import { PricingCta } from '@/components/billing/PricingCta';
import { Reveal } from './Reveal';

// Pricing data/copy is deliberately untouched from the approved pricing
// restructure — only the surrounding card chrome is restyled here. Do not
// change any price, period, feature bullet, or CTA label without a separate,
// explicit pricing decision (see RABBIT_NOTEBOOK.md §1 "Pricing & Plans").
const plans = [
  {
    name: 'Free',
    badge: undefined,
    price: '€0',
    period: '',
    priceDetail: undefined,
    features: ['2 CV analyses per month', '1 cover letter per month', 'PDF & DOCX support'],
    cta: 'Get started free',
    href: '/sign-up',
    highlight: false,
    billingProduct: undefined,
  },
  {
    name: '7-Day Pro Access',
    badge: 'Most Popular',
    price: '€2.99',
    period: 'first 7 days',
    priceDetail:
      '€2.99 today. After 7 days, your subscription renews at €14.99/month unless cancelled. Cancel anytime.',
    features: ['Unlimited CV analyses', 'Unlimited cover letters', 'Priority AI generation'],
    cta: 'Start 7-Day Pro Access',
    href: '/sign-up',
    highlight: true,
    billingProduct: 'pro_monthly',
  },
  {
    name: 'Annual Pro',
    badge: 'Best Value',
    price: '€6.67',
    period: '/ month',
    priceDetail: '€79.99 billed annually. Renews yearly unless cancelled. Cancel anytime.',
    features: ['Everything in 7-Day Pro Access', 'Best value for regular use'],
    cta: 'Start Annual Pro',
    href: '/sign-up',
    highlight: false,
    billingProduct: 'pro_annual',
  },
] as const;

export function PricingSection() {
  return (
    <section
      id="pricing"
      className="relative scroll-mt-24 overflow-hidden bg-[#FCFCFD] px-6 py-24 lg:py-28"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(60% 50% at 50% 0%, rgba(99,102,241,0.07) 0%, rgba(252,252,253,0) 70%)',
        }}
      />
      <div className="relative mx-auto max-w-6xl">
        <Reveal className="mx-auto max-w-2xl text-center">
          <p className="text-xs font-semibold uppercase tracking-widest text-indigo-600">Pricing</p>
          <h2 className="mt-3 text-3xl font-extrabold tracking-tight text-neutral-900 sm:text-4xl lg:text-5xl">
            Simple pricing
          </h2>
          <p className="mt-4 text-lg text-neutral-500">Start free. Upgrade when you need more.</p>
        </Reveal>

        {/* A single cohesive panel behind all three cards, rather than three
            cards floating loosely on plain white — gives the section the
            visual weight/presence it was missing. */}
        <Reveal
          delayMs={100}
          className="relative mt-16 rounded-[2.5rem] border border-neutral-200/70 bg-gradient-to-b from-neutral-50 to-white p-5 sm:p-10 lg:p-12"
        >
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 top-0 mx-auto h-64 max-w-md"
            style={{
              background:
                'radial-gradient(60% 100% at 50% 0%, rgba(99,102,241,0.14) 0%, rgba(255,255,255,0) 75%)',
            }}
          />
          <div className="relative grid gap-8 sm:grid-cols-3 sm:items-stretch">
            {plans.map(
              ({
                name,
                badge,
                price,
                period,
                priceDetail,
                features,
                cta,
                href,
                highlight,
                billingProduct,
              }) => (
                <div
                  key={name}
                  className={`flex flex-col rounded-[1.75rem] border p-8 transition-all duration-300 lg:p-9 ${
                    highlight
                      ? 'border-neutral-900 bg-neutral-950 text-white shadow-[0_1px_2px_rgba(0,0,0,0.2),0_30px_60px_-20px_rgba(79,70,229,0.5)] ring-1 ring-indigo-500/30 sm:-translate-y-4 sm:scale-[1.04]'
                      : 'border-neutral-200 bg-white shadow-[0_1px_2px_rgba(15,15,20,0.03),0_16px_32px_-16px_rgba(15,15,20,0.1)] hover:-translate-y-1 hover:shadow-[0_1px_2px_rgba(15,15,20,0.04),0_20px_40px_-16px_rgba(15,15,20,0.14)]'
                  }`}
                >
                  {badge && (
                    <span
                      className={`mb-5 inline-flex w-fit items-center rounded-full px-3.5 py-1.5 text-xs font-semibold ${
                        highlight
                          ? 'bg-gradient-to-r from-indigo-500 to-violet-500 text-white shadow-sm shadow-indigo-900/40'
                          : 'bg-indigo-50 text-indigo-600'
                      }`}
                    >
                      {badge}
                    </span>
                  )}
                  <p
                    className={`text-xs font-semibold uppercase tracking-widest ${
                      highlight ? 'text-neutral-400' : 'text-neutral-500'
                    }`}
                  >
                    {name}
                  </p>
                  <div className="mt-4 flex items-baseline gap-2">
                    <span className="text-5xl font-extrabold tracking-tight">{price}</span>
                    <span
                      className={`text-sm ${highlight ? 'text-neutral-400' : 'text-neutral-500'}`}
                    >
                      {period}
                    </span>
                  </div>
                  {priceDetail && (
                    <p
                      className={`mt-3.5 text-xs leading-relaxed ${
                        highlight ? 'text-neutral-400' : 'text-neutral-500'
                      }`}
                    >
                      {priceDetail}
                    </p>
                  )}

                  <ul className="mb-9 mt-8 space-y-3.5">
                    {features.map((f) => (
                      <li key={f} className="flex items-start gap-2.5 text-sm">
                        <span
                          className={`mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full ${
                            highlight ? 'bg-indigo-500/20' : 'bg-indigo-50'
                          }`}
                        >
                          <Check
                            className={`h-3 w-3 ${highlight ? 'text-indigo-300' : 'text-indigo-600'}`}
                          />
                        </span>
                        {f}
                      </li>
                    ))}
                  </ul>

                  <div className="mt-auto">
                    {billingProduct ? (
                      <PricingCta
                        product={billingProduct}
                        label={cta}
                        className={`block w-full rounded-full py-3.5 text-center text-sm font-semibold transition-colors ${
                          highlight
                            ? 'bg-white text-neutral-900 hover:bg-neutral-100'
                            : 'bg-neutral-900 text-white hover:bg-neutral-700'
                        }`}
                      />
                    ) : (
                      <Link
                        href={href}
                        className={`block w-full rounded-full py-3.5 text-center text-sm font-semibold transition-colors ${
                          highlight
                            ? 'bg-white text-neutral-900 hover:bg-neutral-100'
                            : 'bg-neutral-900 text-white hover:bg-neutral-700'
                        }`}
                      >
                        {cta}
                      </Link>
                    )}
                  </div>
                </div>
              ),
            )}
          </div>
        </Reveal>
      </div>
    </section>
  );
}
