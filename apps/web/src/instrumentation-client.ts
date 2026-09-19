// Browser-side Sentry init (RABBIT_NOTEBOOK.md — minimal, errors-only
// production monitoring). @sentry/nextjs's webpack plugin auto-injects an
// import of this exact file into the client bundle — see its own
// getInstrumentationClientFile() in node_modules, which is why this file
// lives at this exact path (src/instrumentation-client.ts) rather than
// being imported manually anywhere.
import * as Sentry from '@sentry/nextjs';
import { scrubSentryEvent } from './lib/sentry-scrub';

const dsn = process.env['NEXT_PUBLIC_SENTRY_DSN'];

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env['NODE_ENV'] ?? 'development',
    // Errors only for this pass — no performance tracing, no profiling.
    tracesSampleRate: 0,
    // Session Replay explicitly stays out of this pass — no
    // Sentry.replayIntegration() added, so no replay recording/upload
    // capability exists in this bundle at all.
    sendDefaultPii: false,
    beforeSend: scrubSentryEvent,
  });
} else {
  // No DSN configured (e.g. local dev, or before the real Sentry project
  // exists) — every Sentry.* call becomes a safe no-op; the app must
  // build/run normally either way. See RABBIT_NOTEBOOK.md for the local
  // verification that confirms this.
  console.log('[monitoring] NEXT_PUBLIC_SENTRY_DSN not set — error monitoring is disabled.');
}
