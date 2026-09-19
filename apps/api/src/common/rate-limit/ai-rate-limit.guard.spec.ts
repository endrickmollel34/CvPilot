import { HttpException, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';

import { AiRateLimitGuard } from './ai-rate-limit.guard';
import type { AiRateLimitService } from './ai-rate-limit.service';
import { AI_RATE_LIMIT_MAX_REQUESTS, AI_RATE_LIMIT_WINDOW_MS } from './ai-rate-limit.constants';

/**
 * Unit-level: verifies the HTTP-shaped behavior AiRateLimitGuard is
 * responsible for (status codes, the Retry-After header, the error body's
 * message, and which identity it reads/passes through) with a mocked
 * AiRateLimitService — the real sliding-window Redis behavior itself is
 * covered separately, against real Redis, in ai-rate-limit.service.spec.ts.
 */
describe('AiRateLimitGuard', () => {
  function buildContext(user?: { clerkId?: string }): {
    context: ExecutionContext;
    setHeader: jest.Mock;
  } {
    const setHeader = jest.fn();
    const request = { user };
    const response = { setHeader };
    const context = {
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => response,
      }),
    } as unknown as ExecutionContext;
    return { context, setHeader };
  }

  it('admits the request when the rate limit service allows it', async () => {
    const service = {
      checkAndRecord: jest.fn().mockResolvedValue({ allowed: true, retryAfterMs: 0 }),
    } as unknown as AiRateLimitService;
    const guard = new AiRateLimitGuard(service, {
      limit: AI_RATE_LIMIT_MAX_REQUESTS,
      windowMs: AI_RATE_LIMIT_WINDOW_MS,
    });
    const { context } = buildContext({ clerkId: 'user_abc' });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(service.checkAndRecord).toHaveBeenCalledWith('user_abc', {
      limit: AI_RATE_LIMIT_MAX_REQUESTS,
      windowMs: AI_RATE_LIMIT_WINDOW_MS,
    });
  });

  it('rejects with 429, a Retry-After header, and a clear message when the limit is exhausted', async () => {
    const service = {
      checkAndRecord: jest.fn().mockResolvedValue({ allowed: false, retryAfterMs: 42500 }),
    } as unknown as AiRateLimitService;
    const guard = new AiRateLimitGuard(service, { limit: 5, windowMs: 10 * 60 * 1000 });
    const { context, setHeader } = buildContext({ clerkId: 'user_abc' });

    await expect(guard.canActivate(context)).rejects.toThrow(HttpException);

    try {
      await guard.canActivate(context);
      fail('expected canActivate to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(HttpException);
      const httpErr = err as HttpException;
      expect(httpErr.getStatus()).toBe(429);
      const body = httpErr.getResponse() as { message: string; retryAfterSeconds: number };
      // Plain string message — apps/web's throwApiError surfaces this
      // verbatim to the user for any non-2xx status.
      expect(typeof body.message).toBe('string');
      expect(body.message).toContain('5 AI requests');
      expect(body.message).toContain('10 minutes');
      // ceil(42500ms / 1000) = 43
      expect(body.retryAfterSeconds).toBe(43);
    }

    expect(setHeader).toHaveBeenCalledWith('Retry-After', '43');
  });

  it('rounds retryAfterMs up so the client never retries a fraction of a second too early', async () => {
    const service = {
      checkAndRecord: jest.fn().mockResolvedValue({ allowed: false, retryAfterMs: 100 }),
    } as unknown as AiRateLimitService;
    const guard = new AiRateLimitGuard(service, { limit: 5, windowMs: 10 * 60 * 1000 });
    const { context, setHeader } = buildContext({ clerkId: 'user_abc' });

    await expect(guard.canActivate(context)).rejects.toThrow(HttpException);
    // ceil(100/1000) = 1, and it's floored at a minimum of 1 second either way.
    expect(setHeader).toHaveBeenCalledWith('Retry-After', '1');
  });

  it('returns 503 (never silently admits) when the rate limit service throws — e.g. Redis unavailable', async () => {
    const service = {
      checkAndRecord: jest.fn().mockRejectedValue(new Error('connect ECONNREFUSED')),
    } as unknown as AiRateLimitService;
    const guard = new AiRateLimitGuard(service, {
      limit: AI_RATE_LIMIT_MAX_REQUESTS,
      windowMs: AI_RATE_LIMIT_WINDOW_MS,
    });
    const { context } = buildContext({ clerkId: 'user_abc' });

    await expect(guard.canActivate(context)).rejects.toThrow(ServiceUnavailableException);
  });

  it('throws Unauthorized and never calls the rate limit service when request.user is missing', async () => {
    const service = {
      checkAndRecord: jest.fn(),
    } as unknown as AiRateLimitService;
    const guard = new AiRateLimitGuard(service, {
      limit: AI_RATE_LIMIT_MAX_REQUESTS,
      windowMs: AI_RATE_LIMIT_WINDOW_MS,
    });
    const { context } = buildContext(undefined);

    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
    expect(service.checkAndRecord).not.toHaveBeenCalled();
  });

  it('identifies the caller from request.user.clerkId only — never a client-suppliable header or body field', async () => {
    const service = {
      checkAndRecord: jest.fn().mockResolvedValue({ allowed: true, retryAfterMs: 0 }),
    } as unknown as AiRateLimitService;
    const guard = new AiRateLimitGuard(service, {
      limit: AI_RATE_LIMIT_MAX_REQUESTS,
      windowMs: AI_RATE_LIMIT_WINDOW_MS,
    });
    const request = {
      user: { clerkId: 'trusted_user_id' },
      headers: { 'x-user-id': 'spoofed_user_id' },
      body: { userId: 'spoofed_user_id' },
    };
    const context = {
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => ({ setHeader: jest.fn() }),
      }),
    } as unknown as ExecutionContext;

    await guard.canActivate(context);

    expect(service.checkAndRecord).toHaveBeenCalledWith('trusted_user_id', expect.anything());
  });
});
