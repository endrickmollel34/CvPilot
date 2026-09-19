import type { ErrorEvent, EventHint } from '@sentry/nestjs';

/**
 * The Sentry `beforeSend` hook — the ONE place every outgoing event from
 * this API passes through immediately before being handed to the
 * transport, regardless of which call site produced it (the global
 * exception filter, a background job's own catch block, ...).
 *
 * IMPORTANT (RABBIT_NOTEBOOK.md — privacy follow-up to the original
 * monitoring pass): this used to TRUNCATE long exception messages instead
 * of redacting them. Truncation only limits length — an upstream error
 * message, or a variable interpolated into a thrown Error, can carry real
 * CV content or a credential and still fit comfortably under any length
 * cap (this codebase's own thrown-Error messages are almost always under
 * 300 chars). So every exception `message`/`value` is now unconditionally
 * REPLACED with a fixed, content-free string — never inspected, never
 * pattern-matched against "does this look sensitive" (deliberately: CV
 * text won't match an email/token regex either, so a blacklist can't be
 * trusted). What's preserved instead, because it comes from fields this
 * codebase controls rather than raw upstream text:
 *   - `exception.values[].type` — the error's constructor name (e.g.
 *     "TypeError", "ZodError") — untouched, gives a real error code.
 *   - `tags` (e.g. `queue: 'cv-analysis'`) — untouched, code-authored,
 *     gives the operation label.
 *   - `extra` — allow-listed by KEY (not by scanning the value's
 *     content) to the handful of entity-id fields this codebase's own
 *     capture sites attach, and shape-checked as UUIDs; anything else is
 *     dropped. See scrubExtra below.
 *   - Parsed stack frames (filename/function/line/column) — untouched;
 *     these never contain source text. `frame.vars` (actual local
 *     variable VALUES, only ever populated by Sentry's opt-in
 *     LocalVariablesAsync integration via `includeLocalVariables: true`,
 *     which instrument.ts never sets) is stripped unconditionally anyway,
 *     as defense in depth against that ever being turned on by mistake.
 *
 * Two other categories, extending the original structural pass:
 *   - `event.request` — headers/cookies/body, as before.
 *   - `event.breadcrumbs` — NestJS's `Logger` routes through `console.*`,
 *     which Sentry's default Console integration turns into breadcrumbs
 *     independent of the exception itself; several catch blocks in this
 *     codebase log the raw `err` object as a second argument. Breadcrumb
 *     `message`/`data` are redacted unconditionally, the same way
 *     exception text is.
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
  '[redacted by scrubSentryEvent — raw error text is never sent; see exception type, tags, and extra for diagnosis]';

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

// Entity-id fields this codebase's own Sentry.captureException call sites
// deliberately attach (analysis.service.ts, cover-letter.service.ts,
// parsing.service.ts, tailoring.service.ts) — always our own UUID primary
// keys, never upstream/user content. Allow-listed by KEY, and the value is
// further required to be UUID-shaped, so an unrecognised future key (or a
// recognised key holding something that isn't actually a UUID) is dropped
// by default rather than trusted by name alone.
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
