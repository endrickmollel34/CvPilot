import type { ArgumentsHost } from '@nestjs/common';
import {
  Logger,
  ForbiddenException,
  NotFoundException,
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';

import { GlobalExceptionFilter } from './http-exception.filter';

function mockHost() {
  const res = { status: jest.fn(), json: jest.fn() };
  res.status.mockReturnValue(res);
  const host = {
    switchToHttp: () => ({
      getResponse: () => res,
      getRequest: () => ({}),
    }),
  } as unknown as ArgumentsHost;
  return { host, res };
}

describe('GlobalExceptionFilter', () => {
  let filter: GlobalExceptionFilter;
  let loggerErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    filter = new GlobalExceptionFilter();
    loggerErrorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    loggerErrorSpy.mockRestore();
  });

  // ─── HttpException passthrough — the existing API error contract ──────────

  it('passes through a quota/plan message (ForbiddenException) unchanged, not double-wrapped', () => {
    const { host, res } = mockHost();
    const exception = new ForbiddenException(
      'Monthly analysis limit reached. Upgrade your plan to continue.',
    );

    filter.catch(exception, host);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(exception.getResponse());
    const [body] = res.json.mock.calls[0] as [{ message: unknown }];
    // Frontend's throwApiError() reads body.message directly as a string —
    // wrapping it under a second `message` key would break every quota CTA.
    expect(typeof body.message).toBe('string');
  });

  it('passes through a validation error (string[] message) unchanged', () => {
    const { host, res } = mockHost();
    const exception = new BadRequestException(['title should not exist']);

    filter.catch(exception, host);

    expect(res.status).toHaveBeenCalledWith(400);
    const [body] = res.json.mock.calls[0] as [{ message: unknown }];
    expect(Array.isArray(body.message)).toBe(true);
    expect(body.message).toEqual(['title should not exist']);
  });

  it('passes through a not-found error unchanged', () => {
    const { host, res } = mockHost();
    const exception = new NotFoundException('Analysis abc-123 not found');

    filter.catch(exception, host);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(exception.getResponse());
  });

  it('passes through an authentication error (401) unchanged', () => {
    const { host, res } = mockHost();
    const { UnauthorizedException } = jest.requireActual('@nestjs/common');
    const exception = new UnauthorizedException('Invalid authentication token');

    filter.catch(exception, host);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(exception.getResponse());
  });

  // ─── Unexpected (non-HttpException) errors ─────────────────────────────────

  it('returns a generic, detail-free 500 body for an unexpected error', () => {
    const { host, res } = mockHost();
    const exception = new Error('password authentication failed for user "cvpilot"');

    filter.catch(exception, host);

    expect(res.status).toHaveBeenCalledWith(500);
    const [body] = res.json.mock.calls[0] as {
      statusCode: number;
      message: string;
      timestamp: string;
    }[];
    expect(body).toEqual({
      statusCode: 500,
      message: 'Internal server error',
      timestamp: expect.any(String),
    });
    expect(JSON.stringify(body)).not.toContain('password authentication failed');
  });

  it('logs the full unexpected exception server-side', () => {
    const { host } = mockHost();
    const exception = new Error('boom');

    filter.catch(exception, host);

    expect(loggerErrorSpy).toHaveBeenCalledWith(exception);
  });

  // ─── Logging discipline for HttpExceptions ─────────────────────────────────

  it('logs 5xx HttpExceptions (e.g. a mis-configured third-party provider)', () => {
    const { host } = mockHost();
    const exception = new ServiceUnavailableException(
      'Payments are not configured for this environment.',
    );

    filter.catch(exception, host);

    expect(loggerErrorSpy).toHaveBeenCalledWith(exception);
  });

  it('does not log ordinary 4xx HttpExceptions', () => {
    const { host } = mockHost();
    const exception = new ForbiddenException(
      'Monthly analysis limit reached. Upgrade your plan to continue.',
    );

    filter.catch(exception, host);

    expect(loggerErrorSpy).not.toHaveBeenCalled();
  });
});
