'use client';

import { useState } from 'react';
import { useAuth } from '@clerk/nextjs';

import { createPortalSession } from '@/lib/billingApi';
import { getFriendlyErrorMessage } from '@/lib/errorMessage';

// Stripe's own Customer Portal handles cancellation, payment-method updates,
// and invoice history — this button only ever requests a portal session and
// redirects there. No custom billing-management forms live in this app.
export function ManageBillingButton() {
  const { getToken } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleClick() {
    setLoading(true);
    setError('');
    try {
      const token = await getToken();
      const { url } = await createPortalSession(token!);
      window.location.href = url;
    } catch (err) {
      setError(getFriendlyErrorMessage(err, 'Could not open billing portal. Please try again.'));
      setLoading(false);
    }
  }

  return (
    <div className="text-right">
      <button
        type="button"
        onClick={() => void handleClick()}
        disabled={loading}
        className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
      >
        {loading ? 'Opening…' : 'Manage billing'}
      </button>
      {error && <p className="mt-2 max-w-[220px] text-xs text-red-600">{error}</p>}
    </div>
  );
}
