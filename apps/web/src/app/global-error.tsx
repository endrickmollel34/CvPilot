'use client';

import { useEffect } from 'react';

import './globals.css';

// Only rendered if the root layout itself throws (e.g. ClerkProvider fails
// to initialise) — Next.js requires this to render its own <html>/<body>
// since it replaces the root layout entirely, and to be a Client Component.
// Deliberately minimal: no navigation, no external providers, just a retry.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="en">
      <body>
        <div className="flex min-h-screen items-center justify-center bg-gray-50 px-6">
          <div className="w-full max-w-md rounded-xl border border-gray-200 bg-white p-8 text-center shadow-sm">
            <h1 className="text-lg font-semibold text-gray-900">Something went wrong</h1>
            <p className="mt-2 text-sm text-gray-500">
              CVPilot hit an unexpected error. Please try again.
            </p>
            <div className="mt-6 flex justify-center">
              <button
                onClick={() => reset()}
                className="rounded-md bg-indigo-600 px-5 py-2 text-sm font-medium text-white hover:bg-indigo-700"
              >
                Retry
              </button>
            </div>
          </div>
        </div>
      </body>
    </html>
  );
}
