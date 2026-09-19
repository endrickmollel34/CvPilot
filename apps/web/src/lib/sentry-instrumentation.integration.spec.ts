import * as Sentry from '@sentry/nextjs';
// @sentry/nextjs's own export surface omits these lower-level envelope/
// transport primitives, even though they're present in @sentry/core (a
// transitive dependency either way) — test-only import, not part of this
// app's own production dependency surface. Mirrors
// apps/api/src/common/monitoring/instrument.integration.spec.ts.
import { forEachEnvelopeItem } from '@sentry/core';
import type { Envelope, Event, Transport, TransportMakeRequestResponse } from '@sentry/core';

import { scrubSentryEvent } from './sentry-scrub';

/**
 * End-to-end proof, not just the pure-function unit test in
 * sentry-scrub.spec.ts: a REAL Sentry client (Sentry.init with a
 * syntactically-valid but fake DSN — no real account, no network call ever
 * reaches sentry.io) processing a REAL captureException call through its
 * ACTUAL pipeline (scope/context merging, the beforeSend hook, envelope
 * serialization) and handing the result to a MOCKED transport instead of
 * the real HTTP one.
 */
describe('Sentry instrumentation (apps/web) — end-to-end with a mocked transport', () => {
  let sentReports: Envelope[];
  let client: ReturnType<typeof Sentry.init>;

  function mockTransport(): Transport {
    return {
      send: (envelope: Envelope): PromiseLike<TransportMakeRequestResponse> => {
        sentReports.push(envelope);
        return Promise.resolve({});
      },
      flush: () => Promise.resolve(true),
    };
  }

  function findEventInEnvelopes(): Event | undefined {
    for (const envelope of sentReports) {
      let found: Event | undefined;
      forEachEnvelopeItem(envelope, (item, type) => {
        if (type === 'event' || type === 'transaction') {
          found = item[1] as Event;
        }
      });
      if (found) return found;
    }
    return undefined;
  }

  beforeEach(() => {
    sentReports = [];
    client = Sentry.init({
      dsn: 'https://abc123def456abc123def456abc123@o000000.ingest.sentry.io/0000000',
      environment: 'test',
      tracesSampleRate: 0,
      sendDefaultPii: false,
      beforeSend: scrubSentryEvent,
      transport: mockTransport,
    });
  });

  afterEach(async () => {
    await client?.flush();
    Sentry.getCurrentScope().setClient(undefined);
  });

  it('delivers a captured exception to the transport with its raw message replaced, but the error type preserved', async () => {
    Sentry.captureException(new Error('Synthetic frontend test error'));
    await client!.flush(2000);

    expect(sentReports.length).toBeGreaterThan(0);
    const event = findEventInEnvelopes();
    expect(event?.exception?.values?.[0]?.value).not.toContain('Synthetic frontend test error');
    expect(event?.exception?.values?.[0]?.value).toContain('redacted');
    expect(event?.exception?.values?.[0]?.type).toBe('Error');
  });

  it('redacts a synthetic event carrying an Authorization header, a session cookie, and a CV-content-like request body', async () => {
    Sentry.getCurrentScope().addEventProcessor((event) => {
      event.request = {
        headers: {
          authorization: 'Bearer super-secret-clerk-session-jwt',
          cookie: '__session=abc123',
          'user-agent': 'jest-test-runner',
        },
        cookies: { __session: 'abc123' },
        data: JSON.stringify({ jobDescription: 'Senior Backend Engineer role...' }),
      };
      return event;
    });

    Sentry.captureException(new Error('Synthetic failure with attached request context'));
    await client!.flush(2000);

    const event = findEventInEnvelopes();
    expect(event?.request?.headers).not.toHaveProperty('authorization');
    expect(event?.request?.headers).not.toHaveProperty('cookie');
    expect(event?.request?.headers?.['user-agent']).toBe('jest-test-runner');
    expect(event?.request?.cookies).toBeUndefined();
    expect(event?.request?.data).toBeUndefined();
  });

  it('replaces a long, CV-content-shaped exception message before it reaches the transport', async () => {
    const cvLikeContent = 'Jane Doe, Software Engineer at Acme Corp. '.repeat(30);
    Sentry.captureException(new Error(cvLikeContent));
    await client!.flush(2000);

    const event = findEventInEnvelopes();
    const value = event?.exception?.values?.[0]?.value ?? '';
    expect(value).not.toContain('Jane Doe');
    expect(value).toContain('redacted');
  });

  // ─── Privacy follow-up (RABBIT_NOTEBOOK.md): truncation is not redaction ──
  // Synthetic CV text + a fake credential within the FIRST 100 characters —
  // short enough to survive the OLD 300-char truncation limit intact — must
  // not appear anywhere in the ENTIRE serialized outgoing event: exception
  // values, message, breadcrumbs, or extra. No email/token regex is used to
  // build these markers — they're arbitrary strings, on purpose.

  const CV_TEXT_MARKER = 'Jane Doe — Senior Backend Engineer, 6 years experience at Acme Corp';
  const CREDENTIAL_MARKER = 'sk-CVPILOT_SECRET_MARKER_do_not_leak_1234567890';

  function serializedEventContains(event: Event | undefined, marker: string): boolean {
    return JSON.stringify(event ?? {}).includes(marker);
  }

  it('does not leak short synthetic CV text or a fake credential via the exception message, even though both are under 100 chars', async () => {
    const shortMaliciousError = `${CV_TEXT_MARKER} | key=${CREDENTIAL_MARKER}`;
    expect(shortMaliciousError.length).toBeLessThan(150);

    Sentry.captureException(new Error(shortMaliciousError));
    await client!.flush(2000);

    const event = findEventInEnvelopes();
    expect(event).toBeDefined();
    expect(serializedEventContains(event, CV_TEXT_MARKER)).toBe(false);
    expect(serializedEventContains(event, CREDENTIAL_MARKER)).toBe(false);
  });

  it('does not leak CV text or a fake credential via a breadcrumb', async () => {
    Sentry.addBreadcrumb({
      category: 'console',
      level: 'error',
      message: `Component crashed holding ${CV_TEXT_MARKER}`,
      data: { rawError: CREDENTIAL_MARKER, cvExcerpt: CV_TEXT_MARKER },
    });

    Sentry.captureException(new Error('Unrelated failure that triggers the capture'));
    await client!.flush(2000);

    const event = findEventInEnvelopes();
    expect(event).toBeDefined();
    expect(event?.breadcrumbs?.length).toBeGreaterThan(0);
    expect(serializedEventContains(event, CV_TEXT_MARKER)).toBe(false);
    expect(serializedEventContains(event, CREDENTIAL_MARKER)).toBe(false);
  });

  it('does not leak CV text or a fake credential attached via extra, even under an innocuous-looking key', async () => {
    Sentry.captureException(new Error('Failure with extra context attached'), {
      extra: {
        cvId: '11111111-1111-4111-8111-111111111111',
        debugContext: `${CV_TEXT_MARKER} :: ${CREDENTIAL_MARKER}`,
      },
    });
    await client!.flush(2000);

    const event = findEventInEnvelopes();
    expect(event).toBeDefined();
    expect(event?.extra?.['cvId']).toBe('11111111-1111-4111-8111-111111111111');
    expect(event?.extra).not.toHaveProperty('debugContext');
    expect(serializedEventContains(event, CV_TEXT_MARKER)).toBe(false);
    expect(serializedEventContains(event, CREDENTIAL_MARKER)).toBe(false);
  });

  it('never sends performance/tracing data (tracesSampleRate: 0, errors-only for this pass)', async () => {
    Sentry.captureException(new Error('Just another error, no tracing involved'));
    await client!.flush(2000);

    for (const envelope of sentReports) {
      forEachEnvelopeItem(envelope, (_item, type) => {
        expect(type).not.toBe('transaction');
      });
    }
  });
});
