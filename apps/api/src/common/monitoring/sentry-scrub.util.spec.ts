import type { Breadcrumb, ErrorEvent, EventHint } from '@sentry/nestjs';

import { scrubSentryEvent } from './sentry-scrub.util';

function baseEvent(overrides: Partial<ErrorEvent> = {}): ErrorEvent {
  return { type: undefined, ...overrides };
}

describe('scrubSentryEvent', () => {
  // ─── Structural redaction — headers/cookies/body ───────────────────────

  it('removes the Authorization header (case-insensitive)', () => {
    const event = baseEvent({
      request: { headers: { Authorization: 'Bearer secret-clerk-jwt', 'user-agent': 'jest' } },
    });

    const scrubbed = scrubSentryEvent(event, {} as EventHint);

    expect(scrubbed?.request?.headers).not.toHaveProperty('Authorization');
    expect(scrubbed?.request?.headers?.['user-agent']).toBe('jest'); // safe header kept
  });

  it('removes Cookie and Set-Cookie headers', () => {
    const event = baseEvent({
      request: { headers: { cookie: '__session=abc123', 'set-cookie': 'foo=bar' } },
    });

    const scrubbed = scrubSentryEvent(event, {} as EventHint);

    expect(scrubbed?.request?.headers).toEqual({});
  });

  it('removes the dedicated request.cookies field', () => {
    const event = baseEvent({
      request: { cookies: { __session: 'abc123' } },
    });

    const scrubbed = scrubSentryEvent(event, {} as EventHint);

    expect(scrubbed?.request?.cookies).toBeUndefined();
  });

  it('removes request.data entirely — a POST body could hold CV content, a job description, or prompt input', () => {
    const event = baseEvent({
      request: {
        data: JSON.stringify({
          jobDescription: 'We are looking for a Senior Backend Engineer...',
          cvContent: { personalDetails: { fullName: 'Jane Doe' } },
        }),
      },
    });

    const scrubbed = scrubSentryEvent(event, {} as EventHint);

    expect(scrubbed?.request?.data).toBeUndefined();
  });

  it('is a no-op-shaped pass when the event has no request/exception/breadcrumbs/extra at all', () => {
    const event = baseEvent({});

    const scrubbed = scrubSentryEvent(event, {} as EventHint);

    expect(scrubbed).toEqual(event);
  });

  // ─── Content redaction — exception message/value is REPLACED, not truncated ──

  it('replaces an exception value far longer than any legitimate static error message in this codebase', () => {
    const longUploadedDocumentLikeText = 'Jane Doe\nSoftware Engineer\n'.repeat(50); // ~1400 chars
    const event = baseEvent({
      exception: { values: [{ type: 'Error', value: longUploadedDocumentLikeText }] },
    });

    const scrubbed = scrubSentryEvent(event, {} as EventHint);

    const value = scrubbed?.exception?.values?.[0]?.value ?? '';
    expect(value).not.toContain('Jane Doe');
    expect(value).toContain('redacted');
    // The type (error code) is untouched.
    expect(scrubbed?.exception?.values?.[0]?.type).toBe('Error');
  });

  it('replaces even a SHORT, legitimate-looking exception message — truncation-based length checks cannot be relied on', () => {
    const event = baseEvent({
      exception: { values: [{ type: 'Error', value: 'CV cv-1 has no parsed content' }] },
    });

    const scrubbed = scrubSentryEvent(event, {} as EventHint);

    expect(scrubbed?.exception?.values?.[0]?.value).not.toBe('CV cv-1 has no parsed content');
    expect(scrubbed?.exception?.values?.[0]?.value).toContain('redacted');
  });

  it('replaces a top-level event.message regardless of length', () => {
    const event = baseEvent({ message: 'short and safe' });

    const scrubbed = scrubSentryEvent(event, {} as EventHint);

    expect(scrubbed?.message).not.toBe('short and safe');
    expect(scrubbed?.message).toContain('redacted');
  });

  // ─── Privacy follow-up: synthetic CV text + a fake credential within the
  // first 100 chars of an error must not survive ANYWHERE in the event ────

  const CV_TEXT_MARKER = 'Jane Doe — Senior Backend Engineer, 6 years experience at Acme Corp';
  const CREDENTIAL_MARKER = 'sk-CVPILOT_SECRET_MARKER_do_not_leak_1234567890';

  function eventContainsMarker(event: ErrorEvent, marker: string): boolean {
    return JSON.stringify(event).includes(marker);
  }

  it('strips synthetic CV text and a fake credential from a short exception message (well under any length cap)', () => {
    const shortMaliciousMessage = `${CV_TEXT_MARKER} | key=${CREDENTIAL_MARKER}`;
    expect(shortMaliciousMessage.length).toBeLessThan(150);

    const event = baseEvent({
      exception: { values: [{ type: 'Error', value: shortMaliciousMessage }] },
    });

    const scrubbed = scrubSentryEvent(event, {} as EventHint);

    expect(eventContainsMarker(scrubbed as ErrorEvent, CV_TEXT_MARKER)).toBe(false);
    expect(eventContainsMarker(scrubbed as ErrorEvent, CREDENTIAL_MARKER)).toBe(false);
  });

  it('strips synthetic CV text and a fake credential from breadcrumb message AND data fields', () => {
    const breadcrumb: Breadcrumb = {
      category: 'console',
      level: 'error',
      message: `CV ${CV_TEXT_MARKER} failed to parse`,
      data: { rawError: CREDENTIAL_MARKER, cvExcerpt: CV_TEXT_MARKER },
    };
    const event = baseEvent({ breadcrumbs: [breadcrumb] });

    const scrubbed = scrubSentryEvent(event, {} as EventHint);

    expect(eventContainsMarker(scrubbed as ErrorEvent, CV_TEXT_MARKER)).toBe(false);
    expect(eventContainsMarker(scrubbed as ErrorEvent, CREDENTIAL_MARKER)).toBe(false);
    // Breadcrumb itself is kept (category/level preserved) — only its
    // content-carrying fields are redacted.
    expect(scrubbed?.breadcrumbs?.[0]?.category).toBe('console');
    expect(scrubbed?.breadcrumbs?.[0]?.data).toBeUndefined();
  });

  it('drops non-allow-listed extra keys entirely, even when the value is short and does not match any sensitive-pattern regex', () => {
    const event = baseEvent({
      extra: {
        cvId: '11111111-1111-4111-8111-111111111111',
        debugContext: `${CV_TEXT_MARKER} :: ${CREDENTIAL_MARKER}`,
      },
    });

    const scrubbed = scrubSentryEvent(event, {} as EventHint);

    expect(scrubbed?.extra?.['cvId']).toBe('11111111-1111-4111-8111-111111111111');
    expect(scrubbed?.extra).not.toHaveProperty('debugContext');
    expect(eventContainsMarker(scrubbed as ErrorEvent, CV_TEXT_MARKER)).toBe(false);
    expect(eventContainsMarker(scrubbed as ErrorEvent, CREDENTIAL_MARKER)).toBe(false);
  });

  it('drops an allow-listed extra key whose value is not actually UUID-shaped (name alone is not trusted)', () => {
    const event = baseEvent({
      extra: { cvId: CV_TEXT_MARKER },
    });

    const scrubbed = scrubSentryEvent(event, {} as EventHint);

    expect(scrubbed?.extra).not.toHaveProperty('cvId');
  });

  it('strips stack frame local-variable values (frame.vars) unconditionally, defense in depth against LocalVariablesAsync', () => {
    const event = baseEvent({
      exception: {
        values: [
          {
            type: 'Error',
            value: 'boom',
            stacktrace: {
              frames: [
                {
                  filename: 'prefill-extraction.service.ts',
                  function: 'extract',
                  lineno: 42,
                  vars: { cvText: CV_TEXT_MARKER, apiKey: CREDENTIAL_MARKER },
                },
              ],
            },
          },
        ],
      },
    });

    const scrubbed = scrubSentryEvent(event, {} as EventHint);

    const frame = scrubbed?.exception?.values?.[0]?.stacktrace?.frames?.[0];
    expect(frame?.vars).toBeUndefined();
    // Safe, structural frame fields are untouched.
    expect(frame?.filename).toBe('prefill-extraction.service.ts');
    expect(frame?.function).toBe('extract');
    expect(frame?.lineno).toBe(42);
    expect(eventContainsMarker(scrubbed as ErrorEvent, CV_TEXT_MARKER)).toBe(false);
    expect(eventContainsMarker(scrubbed as ErrorEvent, CREDENTIAL_MARKER)).toBe(false);
  });

  // ─── Combined — the realistic shape of a real captured event ───────────

  it('scrubs headers/cookies/body AND redacts message/breadcrumbs/extra on the same event', () => {
    const event = baseEvent({
      request: {
        headers: { authorization: 'Bearer xyz', cookie: '__session=abc' },
        cookies: { __session: 'abc' },
        data: 'raw body with job description text',
      },
      exception: {
        values: [{ type: 'Error', value: `${CV_TEXT_MARKER} ${CREDENTIAL_MARKER}` }],
      },
      breadcrumbs: [
        { category: 'console', message: CV_TEXT_MARKER, data: { k: CREDENTIAL_MARKER } },
      ],
      extra: { cvId: '11111111-1111-4111-8111-111111111111', stray: CREDENTIAL_MARKER },
    });

    const scrubbed = scrubSentryEvent(event, {} as EventHint);

    expect(scrubbed?.request?.headers).toEqual({});
    expect(scrubbed?.request?.cookies).toBeUndefined();
    expect(scrubbed?.request?.data).toBeUndefined();
    expect(scrubbed?.extra?.['cvId']).toBe('11111111-1111-4111-8111-111111111111');
    expect(scrubbed?.extra).not.toHaveProperty('stray');
    expect(eventContainsMarker(scrubbed as ErrorEvent, CV_TEXT_MARKER)).toBe(false);
    expect(eventContainsMarker(scrubbed as ErrorEvent, CREDENTIAL_MARKER)).toBe(false);
  });
});
