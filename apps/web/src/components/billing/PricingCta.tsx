'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@clerk/nextjs';

import { createCheckoutSession, type BillingPlan } from '@/lib/billingApi';
import { getFriendlyErrorMessage } from '@/lib/errorMessage';

interface Props {
  plan: BillingPlan;
  label: string;
  className: string;
}

// Fixes the bug where an authenticated user clicking a paid-plan CTA
// (Pro/Student) landed on Clerk's sign-up screen instead of Stripe Checkout:
// that CTA was a plain `<Link href="/sign-up">`, identical to the Free plan's
// button, with no billing wiring at all. Signed-out visitors still go to
// sign-up (unchanged); signed-in users get a real checkout session.
export function PricingCta({ plan, label, className }: Props) {
  const { isSignedIn, getToken } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  if (!isSignedIn) {
    return (
      <Link href="/sign-up" className={className}>
        {label}
      </Link>
    );
  }

  async function handleClick() {
    setLoading(true);
    setError('');
    try {
      const token = await getToken();
      const { url } = await createCheckoutSession(token!, plan);
      if (!url) {
        setError('Could not start checkout. Please try again.');
        return;
      }
      window.location.href = url;
    } catch (err) {
      setError(getFriendlyErrorMessage(err, 'Could not start checkout. Please try again.'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => void handleClick()}
        disabled={loading}
        className={className}
      >
        {loading ? 'Redirecting…' : label}
      </button>
      {error && <p className="mt-2 text-center text-xs text-red-600">{error}</p>}
    </div>
  );
}
