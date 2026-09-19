// Minimal, errors-only production monitoring (RABBIT_NOTEBOOK.md). Must be
// imported FIRST, before any other module — main.ts does this as its very
// first line — so the Sentry Node SDK can instrument everything else that
// gets imported afterward. See @sentry/nestjs's own README for why this
// file exists separately from main.ts.
import { config as loadDotenv } from 'dotenv';
import * as Sentry from '@sentry/nestjs';
import { scrubSentryEvent } from './common/monitoring/sentry-scrub.util';

// RABBIT_NOTEBOOK.md §32: this file is imported before `./app.module`, and
// `.env` is otherwise only ever loaded as a SIDE EFFECT of importing
// ConfigModule.forRoot() inside app.module.ts — which happens later, when
// main.ts's `import { AppModule } from './app.module'` line runs. Reading
// `process.env['SENTRY_DSN']` below, before that has happened, silently saw
// `undefined` every time in production/dev, no matter what `.env` actually
// contained — Sentry.init() was never called, yet Sentry.captureException()
// still returned a real-looking event id anyway (its id generation doesn't
// require a client), so this went undetected by every local test that only
// checked "did I get an event id back" rather than real dashboard delivery.
// Loading `.env` here directly (same default `.env`-in-cwd behavior
// `@nestjs/config` itself uses, so no path mismatch) fixes the ordering;
// harmless to also run again later inside ConfigModule.forRoot(), since
// dotenv's default behavior never overwrites a value process.env already has.
loadDotenv();

const dsn = process.env['SENTRY_DSN'];

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env['NODE_ENV'] ?? 'development',
    // Errors only for this pass — no performance tracing, no profiling.
    tracesSampleRate: 0,
    // Never automatically attach cookies/IP/other PII to events — scrubbing
    // in scrubSentryEvent below is the authoritative backstop regardless,
    // but this asks the SDK's own integrations not to collect it up front.
    sendDefaultPii: false,
    // Explicit, not just "never set": @sentry/nestjs's default integration
    // set includes LocalVariablesAsync, which (only when this flag is
    // true) captures actual local-variable VALUES at the throw site via
    // the V8 inspector — e.g. a `cvText` or `parsedContent` local, in full,
    // independent of the thrown error's own message. Confirmed via direct
    // inspection of node_modules/@sentry/node-core's implementation. This
    // stays false; scrubSentryEvent also strips any `frame.vars` that
    // slips through regardless, as defense in depth.
    includeLocalVariables: false,
    beforeSend: scrubSentryEvent,
  });
} else {
  // No DSN configured (e.g. local dev, or before the real Sentry project
  // exists) — every Sentry.* call becomes a safe no-op; the app must start
  // and run normally either way. See RABBIT_NOTEBOOK.md for the local
  // verification that confirms this.

  console.log('[monitoring] SENTRY_DSN not set — error monitoring is disabled.');
}
