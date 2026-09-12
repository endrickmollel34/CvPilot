import Link from 'next/link';
import { Show } from '@clerk/nextjs';
import { ArrowRight, Upload, ClipboardList, BarChart3, Check } from 'lucide-react';

import { PricingCta } from '@/components/billing/PricingCta';

export default function HomePage() {
  return (
    <div className="min-h-screen bg-white text-neutral-900">
      {/* ── Navigation ─────────────────────────────────────────────────────── */}
      <nav className="sticky top-0 z-10 border-b border-neutral-100 bg-white/90 backdrop-blur-sm">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <span className="text-lg font-bold tracking-tight">CVPilot</span>
          <div className="flex items-center gap-3">
            <Show when="signed-out">
              <Link href="/sign-in" className="text-sm text-neutral-600 hover:text-neutral-900">
                Sign in
              </Link>
              <Link
                href="/sign-up"
                className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700"
              >
                Get started free
              </Link>
            </Show>
            <Show when="signed-in">
              <Link
                href="/dashboard"
                className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700"
              >
                Go to dashboard
              </Link>
            </Show>
          </div>
        </div>
      </nav>

      <main>
        {/* ── Hero ───────────────────────────────────────────────────────────── */}
        <section className="mx-auto max-w-5xl px-6 py-24 text-center">
          <p className="mb-4 text-xs font-semibold uppercase tracking-widest text-neutral-400">
            Built for every career move
          </p>
          <h1 className="text-5xl font-extrabold leading-tight tracking-tight sm:text-6xl">
            Build, improve, and tailor
            <br />
            your CV — with AI.
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg text-neutral-600">
            Create a CV from scratch or upload an existing one, get an instant AI match score
            against any job description, and generate a tailored cover letter — all in one place.
          </p>

          <div className="mt-10 flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
            <Show when="signed-out">
              <Link
                href="/sign-up"
                className="inline-flex items-center gap-2 rounded-md bg-neutral-900 px-8 py-3 text-base font-semibold text-white hover:bg-neutral-700"
              >
                Get started — it&apos;s free
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Show>
            <Show when="signed-in">
              <Link
                href="/dashboard"
                className="inline-flex items-center gap-2 rounded-md bg-neutral-900 px-8 py-3 text-base font-semibold text-white hover:bg-neutral-700"
              >
                Go to dashboard
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Show>
          </div>
          <p className="mt-4 text-sm text-neutral-400">No credit card required.</p>
        </section>

        {/* ── How it works ───────────────────────────────────────────────────── */}
        <section className="border-t border-neutral-100 bg-neutral-50 px-6 py-20">
          <div className="mx-auto max-w-5xl">
            <h2 className="text-center text-2xl font-bold tracking-tight">
              Three steps. Under a minute.
            </h2>

            <div className="mt-12 grid gap-6 sm:grid-cols-3">
              {steps.map(({ Icon, number, title, body }) => (
                <div key={number} className="rounded-xl border border-neutral-200 bg-white p-6">
                  <div className="mb-4 flex items-center gap-3">
                    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-neutral-900 text-sm font-bold text-white">
                      {number}
                    </span>
                    <Icon className="h-5 w-5 text-neutral-400" />
                  </div>
                  <h3 className="font-semibold">{title}</h3>
                  <p className="mt-2 text-sm text-neutral-500">{body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── Pricing ────────────────────────────────────────────────────────── */}
        <section id="pricing" className="px-6 py-20">
          <div className="mx-auto max-w-5xl">
            <h2 className="text-center text-2xl font-bold tracking-tight">Simple pricing</h2>
            <p className="mt-2 text-center text-sm text-neutral-500">
              Start free. Upgrade when you need more.
            </p>

            <div className="mt-12 grid gap-6 sm:grid-cols-3">
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
                    className={`rounded-xl border p-6 ${
                      highlight
                        ? 'border-neutral-900 bg-neutral-900 text-white'
                        : 'border-neutral-200 bg-white'
                    }`}
                  >
                    {badge && (
                      <span
                        className={`mb-3 inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                          highlight ? 'bg-white text-neutral-900' : 'bg-neutral-900 text-white'
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
                    <div className="mt-2 flex items-baseline gap-1">
                      <span className="text-3xl font-extrabold">{price}</span>
                      <span
                        className={`text-sm ${highlight ? 'text-neutral-400' : 'text-neutral-500'}`}
                      >
                        {period}
                      </span>
                    </div>
                    {priceDetail && (
                      <p
                        className={`mt-2 text-xs leading-relaxed ${
                          highlight ? 'text-neutral-400' : 'text-neutral-500'
                        }`}
                      >
                        {priceDetail}
                      </p>
                    )}

                    <ul className="mt-6 mb-8 space-y-3">
                      {features.map((f) => (
                        <li key={f} className="flex items-start gap-2 text-sm">
                          <Check
                            className={`mt-0.5 h-4 w-4 flex-shrink-0 ${
                              highlight ? 'text-neutral-400' : 'text-neutral-400'
                            }`}
                          />
                          {f}
                        </li>
                      ))}
                    </ul>

                    {billingProduct ? (
                      <PricingCta
                        product={billingProduct}
                        label={cta}
                        className={`block w-full rounded-md py-2 text-center text-sm font-semibold transition-colors ${
                          highlight
                            ? 'bg-white text-neutral-900 hover:bg-neutral-100'
                            : 'bg-neutral-900 text-white hover:bg-neutral-700'
                        }`}
                      />
                    ) : (
                      <Link
                        href={href}
                        className={`block w-full rounded-md py-2 text-center text-sm font-semibold transition-colors ${
                          highlight
                            ? 'bg-white text-neutral-900 hover:bg-neutral-100'
                            : 'bg-neutral-900 text-white hover:bg-neutral-700'
                        }`}
                      >
                        {cta}
                      </Link>
                    )}
                  </div>
                ),
              )}
            </div>
          </div>
        </section>
      </main>

      {/* ── Footer ─────────────────────────────────────────────────────────── */}
      <footer className="border-t border-neutral-100 px-6 py-8">
        <div className="mx-auto flex max-w-5xl flex-col items-center justify-between gap-3 text-sm text-neutral-400 sm:flex-row">
          <span>© 2026 CVPilot</span>
          <span>Helping you land more interviews.</span>
          <div className="flex items-center gap-4">
            <Link href="/privacy" className="hover:text-neutral-600">
              Privacy
            </Link>
            <Link href="/terms" className="hover:text-neutral-600">
              Terms
            </Link>
            <Link href="/contact" className="hover:text-neutral-600">
              Contact
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}

// ── Data ───────────────────────────────────────────────────────────────────────

const steps = [
  {
    Icon: Upload,
    number: '1',
    title: 'Upload your CV',
    body: 'PDF or DOCX. We parse it automatically — no copy-pasting required.',
  },
  {
    Icon: ClipboardList,
    number: '2',
    title: 'Paste the job description',
    body: 'Any role, any company, any sector. Just paste and go.',
  },
  {
    Icon: BarChart3,
    number: '3',
    title: 'Get your score and fix it',
    body: 'AI match score, specific suggestions, and a tailored cover letter in one click.',
  },
] as const;

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
