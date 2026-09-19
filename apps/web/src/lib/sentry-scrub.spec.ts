import type { Breadcrumb, ErrorEvent, EventHint } from '@sentry/nextjs';

import { scrubSentryEvent } from './sentry-scrub';

function baseEvent(overrides: Partial<ErrorEvent> = {}): ErrorEvent {
  return { type: undefined, ...overrides };
}

const CV_TEXT_MARKER = 'Jane Doe — Senior Backend Engineer, 6 years experience at Acme Corp';
const CREDENTIAL_MARKER = 'sk-CVPILOT_SECRET_MARKER_do_not_leak_1234567890';

function eventContainsMarker(event: ErrorEvent, marker: string): boolean {
  return JSON.stringify(event).includes(marker);
}

describe('scrubSentryEvent (apps/web)', () => {
  it('removes the Authorization header (case-insensitive)', () => {
    const event = baseEvent({
      request: { headers: { Authorization: 'Bearer secret-clerk-jwt', 'user-agent': 'jest' } },
    });

    const scrubbed = scrubSentryEvent(event, {} as EventHint);

    expect(scrubbed?.request?.headers).not.toHaveProperty('Authorization');
    expect(scrubbed?.request?.headers?.['user-agent']).toBe('jest');
  });

  it('removes Cookie/Set-Cookie headers and the dedicated cookies field', () => {
    const event = baseEvent({
      request: {
        headers: { cookie: '__session=abc123', 'set-cookie': 'foo=bar' },
        cookies: { __session: 'abc123' },
      },
    });

    const scrubbed = scrubSentryEvent(event, {} as EventHint);

    expect(scrubbed?.request?.headers).toEqual({});
    expect(scrubbed?.request?.cookies).toBeUndefined();
  });

  it('removes request.data entirely — could hold CV content or a job description from a failed API call', () => {
    const event = baseEvent({
      request: { data: JSON.stringify({ jobDescription: 'Senior Backend Engineer...' }) },
    });

    const scrubbed = scrubSentryEvent(event, {} as EventHint);

    expect(scrubbed?.request?.data).toBeUndefined();
  });

  it('replaces a long exception message rather than truncating it', () => {
    const cvLikeContent = 'Jane Doe, Software Engineer at Acme Corp. '.repeat(30);
    const event = baseEvent({ exception: { values: [{ type: 'Error', value: cvLikeContent }] } });

    const scrubbed = scrubSentryEvent(event, {} as EventHint);

    const value = scrubbed?.exception?.values?.[0]?.value ?? '';
    expect(value).not.toContain('Jane Doe');
    expect(value).toContain('redacted');
  });

  it('replaces even a SHORT, legitimate-looking exception message — length is not a valid safety signal', () => {
    const event = baseEvent({
      exception: { values: [{ type: 'Error', value: 'Network request failed' }] },
    });

    const scrubbed = scrubSentryEvent(event, {} as EventHint);

    expect(scrubbed?.exception?.values?.[0]?.value).not.toBe('Network request failed');
    expect(scrubbed?.exception?.values?.[0]?.value).toContain('redacted');
  });

  it('is a no-op-shaped pass when the event has no request/exception/breadcrumbs/extra at all', () => {
    const event = baseEvent({});

    const scrubbed = scrubSentryEvent(event, {} as EventHint);

    expect(scrubbed).toEqual(event);
  });

  // ─── Privacy follow-up: synthetic CV text + a fake credential within the
  // first 100 chars of an error must not survive ANYWHERE in the event ────

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
      message: `Component crashed holding ${CV_TEXT_MARKER}`,
      data: { rawError: CREDENTIAL_MARKER, cvExcerpt: CV_TEXT_MARKER },
    };
    const event = baseEvent({ breadcrumbs: [breadcrumb] });

    const scrubbed = scrubSentryEvent(event, {} as EventHint);

    expect(eventContainsMarker(scrubbed as ErrorEvent, CV_TEXT_MARKER)).toBe(false);
    expect(eventContainsMarker(scrubbed as ErrorEvent, CREDENTIAL_MARKER)).toBe(false);
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

  it('strips stack frame local-variable values (frame.vars) unconditionally', () => {
    const event = baseEvent({
      exception: {
        values: [
          {
            type: 'Error',
            value: 'boom',
            stacktrace: {
              frames: [
                {
                  filename: 'CvBuilderWorkspace.tsx',
                  function: 'onSave',
                  lineno: 10,
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
    expect(frame?.filename).toBe('CvBuilderWorkspace.tsx');
    expect(eventContainsMarker(scrubbed as ErrorEvent, CV_TEXT_MARKER)).toBe(false);
    expect(eventContainsMarker(scrubbed as ErrorEvent, CREDENTIAL_MARKER)).toBe(false);
  });

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
