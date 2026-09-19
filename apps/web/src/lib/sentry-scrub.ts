import type { ErrorEvent, EventHint } from '@sentry/nextjs';

/**
 * The Sentry `beforeSend` hook for BOTH the browser and server/edge
 * runtimes (all three instrumentation entry points below pass their event
 * through this same function) — mirrors apps/api's
 * common/monitoring/sentry-scrub.util.ts (same reasoning, same
 * redaction strategy), adapted for this app's own risk surface: a
 * rendering crash could occur while a component holds CV content, a job
 * description, or a Clerk session in local component state, and the
 * request/response pair for a failed API call the frontend made could
 * include the same Authorization/cookie headers CVPilot's own API sends.
 *
 * IMPORTANT (RABBIT_NOTEBOOK.md — privacy follow-up to the original
 * monitoring pass): this used to TRUNCATE long exception messages instead
 * of redacting them. Truncation only limits length — it does nothing to
 * stop short, sensitive content (CV text, a credential) from being sent
 * verbatim. Exception `message`/`value` text is now unconditionally
 * REPLACED with a fixed, content-free string, never pattern-matched
 * against "does this look sensitive" (a blacklist regex can't be trusted
 * to catch arbitrary CV text). What's preserved instead, because it comes
 * from fields this app controls rather than raw thrown text:
 *   - `exception.values[].type` — the error's constructor name — untouched.
 *   - Parsed stack frames (filename/function/line/column) — untouched;
 *     `frame.vars` is stripped unconditionally as defense in depth (the
 *     browser SDK doesn't have a local-variable-capture integration like
 *     the Node SDK's opt-in LocalVariablesAsync, but this keeps the two
 *     apps' scrub functions structurally identical and future-proof).
 *   - `event.breadcrumbs` — redacted the same way (`message`/`data`
 *     stripped unconditionally) since console/fetch/DOM breadcrumbs can
 *     carry arbitrary interpolated values independent of the exception
 *     itself.
 */
export function scrubSentryEvent(event: ErrorEvent, _hint: EventHint): ErrorEvent | null {
  scrubRequest(event);
  redactExceptionText(event);
  scrubBreadcrumbs(event);
  scrubExtra(event);
  scrubStackFrameVars(event);
  return event;
}

const SENSITIVE_HEADER_NAMES = new Set([
  'authorization',
  'cookie',
  'set-cookie',
  'proxy-authorization',
  'x-api-key',
]);

function scrubRequest(event: ErrorEvent): void {
  const request = event.request;
  if (!request) return;

  // Request/response bodies can hold CV content, job descriptions, or
  // uploaded-document text — never sent, full stop.
  delete request.data;
  delete request.cookies;

  if (request.headers) {
    for (const key of Object.keys(request.headers)) {
      if (SENSITIVE_HEADER_NAMES.has(key.toLowerCase())) {
        delete request.headers[key];
      }
    }
  }
}

const REDACTED_TEXT =
  '[redacted by scrubSentryEvent — raw error text is never sent; see exception type and extra for diagnosis]';

function redactExceptionText(event: ErrorEvent): void {
  if (event.message) {
    event.message = REDACTED_TEXT;
  }
  for (const exceptionValue of event.exception?.values ?? []) {
    if (exceptionValue.value) {
      exceptionValue.value = REDACTED_TEXT;
    }
  }
}

function scrubBreadcrumbs(event: ErrorEvent): void {
  if (!event.breadcrumbs) return;
  for (const crumb of event.breadcrumbs) {
    if (crumb.message !== undefined) {
      crumb.message = REDACTED_TEXT;
    }
    delete crumb.data;
  }
}

// Same allow-by-key-and-shape policy as apps/api's scrub — this app's own
// capture sites (error.tsx/global-error.tsx) don't currently attach any
// `extra`, but the same guard is kept here so a future call site can't
// accidentally leak arbitrary content through it by default.
const ALLOWED_EXTRA_KEYS = new Set([
  'cvId',
  'analysisId',
  'coverLetterId',
  'tailoringId',
  'jobId',
  'userId',
]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function scrubExtra(event: ErrorEvent): void {
  if (!event.extra) return;
  for (const key of Object.keys(event.extra)) {
    const value = event.extra[key];
    if (!ALLOWED_EXTRA_KEYS.has(key) || typeof value !== 'string' || !UUID_RE.test(value)) {
      delete event.extra[key];
    }
  }
}

function scrubStackFrameVars(event: ErrorEvent): void {
  for (const exceptionValue of event.exception?.values ?? []) {
    for (const frame of exceptionValue.stacktrace?.frames ?? []) {
      delete frame.vars;
    }
  }
}
