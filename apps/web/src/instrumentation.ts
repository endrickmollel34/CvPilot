// Next.js's own instrumentation hook (stable since Next.js 14 — no
// experimental flag needed). RABBIT_NOTEBOOK.md — minimal, errors-only
// production monitoring: this file handles the SERVER and EDGE runtimes;
// see instrumentation-client.ts for the browser. @sentry/nextjs v10
// deprecated the older sentry.server.config.ts/sentry.edge.config.ts
// pattern in favor of calling Sentry.init() directly here (confirmed in
// its own source — warnAboutDeprecatedConfigFiles() in node_modules warns
// exactly when those old files exist instead).
import * as Sentry from '@sentry/nextjs';

import { scrubSentryEvent } from './lib/sentry-scrub';

export async function register(): Promise<void> {
  const dsn = process.env['NEXT_PUBLIC_SENTRY_DSN'];
  if (!dsn) {
    // No DSN configured — every Sentry.* call (including the
    // onRequestError hook below) becomes a safe no-op; the app must
    // start/run normally either way. See RABBIT_NOTEBOOK.md for the local
    // verification that confirms this.
    console.log('[monitoring] NEXT_PUBLIC_SENTRY_DSN not set — error monitoring is disabled.');
    return;
  }

  if (process.env.NEXT_RUNTIME === 'nodejs' || process.env.NEXT_RUNTIME === 'edge') {
    Sentry.init({
      dsn,
      environment: process.env['NODE_ENV'] ?? 'development',
      tracesSampleRate: 0,
      sendDefaultPii: false,
      beforeSend: scrubSentryEvent,
    });
  }
}

// Covers errors thrown by nested React Server Components — a rendering
// path error.tsx/global-error.tsx (client-side error boundaries) can't
// reach on their own. Sentry's own recommended hook; a plain function
// reference, safe to export unconditionally regardless of whether
// Sentry.init() above actually ran (it's a no-op either way without a
// configured client).
export const onRequestError = Sentry.captureRequestError;
