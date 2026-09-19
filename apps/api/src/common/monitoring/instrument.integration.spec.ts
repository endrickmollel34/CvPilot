import * as Sentry from '@sentry/nestjs';
// @sentry/nestjs's own export surface (re-exported from @sentry/node) omits
// these lower-level envelope/transport primitives, even though they're
// present in @sentry/core (a transitive dependency either way) — test-only
// import, not part of this app's own production dependency surface.
import { forEachEnvelopeItem } from '@sentry/core';
import type { Envelope, Event, Transport, TransportMakeRequestResponse } from '@sentry/core';

import { scrubSentryEvent } from './sentry-scrub.util';

/**
 * End-to-end proof, not just the pure-function unit test in
 * sentry-scrub.util.spec.ts: a REAL Sentry client (Sentry.init with a
 * syntactically-valid but fake DSN — no real account, no network call ever
 * reaches sentry.io) processing a REAL captureException call through its
 * ACTUAL pipeline (scope/context merging, breadcrumb attachment, the
 * beforeSend hook, envelope serialization) and handing the result to a
 * MOCKED transport instead of the real HTTP one. This is what "verify
 * capture and redaction locally using synthetic errors and a mocked
 * transport" (RABBIT_NOTEBOOK.md) means concretely — confirms the WIRING
 * (does captureException's request/extra/breadcrumb context actually
 * reach beforeSend, does a scrubbed event actually reach the transport),
 * not just that scrubSentryEvent is correct in isolation.
 */
describe('Sentry instrumentation — end-to-end with a mocked transport', () => {
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
    // A syntactically valid Sentry DSN shape pointing at a made-up
    // project — Sentry.init() only parses this locally to build outgoing
    // envelope headers; combined with the mocked transport below, no
    // network request is ever made, real or otherwise.
    client = Sentry.init({
      dsn: 'https://abc123def456abc123def456abc123@o000000.ingest.sentry.io/0000000',
      environment: 'test',
      tracesSampleRate: 0,
      sendDefaultPii: false,
      includeLocalVariables: false,
      beforeSend: scrubSentryEvent,
      transport: mockTransport,
    });
  });

  afterEach(async () => {
    await client?.flush();
    // Sentry.init() sets a process-wide current client; clear it so this
    // suite's fake DSN/mock transport can never leak into another test
    // file's own Sentry usage within the same worker.
    Sentry.getCurrentScope().setClient(undefined);
  });

  it('delivers a captured exception to the transport with its raw message replaced, but the error type preserved', async () => {
    const syntheticError = new Error('Synthetic test error — DB connection refused');

    Sentry.captureException(syntheticError);
    await client!.flush(2000);

    expect(sentReports.length).toBeGreaterThan(0);
    const event = findEventInEnvelopes();
    expect(event).toBeDefined();
    expect(event?.exception?.values?.[0]?.value).not.toContain('DB connection refused');
    expect(event?.exception?.values?.[0]?.value).toContain('redacted');
    // The error TYPE (constructor name) is a code-controlled, bounded
    // field — kept, since it's the "useful error code" the redesign is
    // meant to still retain.
    expect(event?.exception?.values?.[0]?.type).toBe('Error');
  });

  it('redacts a synthetic event carrying an Authorization header, a session cookie, and a CV-content-like request body', async () => {
    const scope = Sentry.getCurrentScope();
    scope.addEventProcessor((event) => {
      // Simulates what Sentry's Node HTTP integration actually populates
      // event.request with from a real inbound Express request — done via
      // an event processor (runs before beforeSend, same as the real
      // integration) rather than a full HTTP server, so this test stays
      // fast and isolated while still exercising the real beforeSend path
      // this event will flow through.
      event.request = {
        headers: {
          authorization: 'Bearer super-secret-clerk-session-jwt',
          cookie: '__session=abc123; other=1',
          'user-agent': 'jest-test-runner',
        },
        cookies: { __session: 'abc123' },
        data: JSON.stringify({
          jobDescription: 'Senior Backend Engineer role requiring 5+ years...',
          cvContent: { personalDetails: { fullName: 'Synthetic Test User' } },
        }),
      };
      return event;
    });

    Sentry.captureException(new Error('Synthetic failure with attached request context'));
    await client!.flush(2000);

    const event = findEventInEnvelopes();
    expect(event).toBeDefined();
    expect(event?.request?.headers).not.toHaveProperty('authorization');
    expect(event?.request?.headers).not.toHaveProperty('cookie');
    expect(event?.request?.headers?.['user-agent']).toBe('jest-test-runner');
    expect(event?.request?.cookies).toBeUndefined();
    expect(event?.request?.data).toBeUndefined();
  });

  // ─── Privacy follow-up (RABBIT_NOTEBOOK.md): truncation is not redaction ──
  //
  // These place synthetic CV text and a fake credential within the FIRST
  // 100 characters of an error — short enough to survive the OLD 300-char
  // truncation limit completely intact — then scan the ENTIRE serialized
  // outgoing event (not just exception.values[].value) for either marker.
  // Deliberately no email/token-shaped regex is used to build the marker
  // itself; "CVPILOT_SECRET_MARKER" and the CV sentence are just arbitrary
  // strings, proving the redaction doesn't depend on recognising a pattern.

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

  it('does not leak CV text or a fake credential via a breadcrumb (e.g. from Logger routing through the Console integration)', async () => {
    Sentry.addBreadcrumb({
      category: 'console',
      level: 'error',
      message: `CV ${CV_TEXT_MARKER} failed to parse`,
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
        cvId: '11111111-1111-4111-8111-111111111111', // allow-listed key + UUID shape — kept
        debugContext: `${CV_TEXT_MARKER} :: ${CREDENTIAL_MARKER}`, // NOT allow-listed — must be dropped
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
    // No span/transaction API call in this test at all — the absence of
    // any 'transaction' envelope item across every test in this file is
    // the actual proof; this test just makes that assertion explicit
    // against everything captured so far in this file's own run.
    Sentry.captureException(new Error('Just another error, no tracing involved'));
    await client!.flush(2000);

    for (const envelope of sentReports) {
      forEachEnvelopeItem(envelope, (_item, type) => {
        expect(type).not.toBe('transaction');
      });
    }
  });
});
