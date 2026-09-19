import {
  type CanActivate,
  type ExecutionContext,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request, Response } from 'express';

import { AiRateLimitService } from './ai-rate-limit.service';
import { AI_RATE_LIMIT_OPTIONS, type AiRateLimitOptions } from './ai-rate-limit.constants';

/**
 * Applied per-ROUTE (not per-controller — several controllers this guards
 * mix AI-triggering endpoints with plain CRUD ones), on every user-
 * triggered paid AI entry point: POST /analyses, POST /cover-letters,
 * POST /cover-letters/:id/regenerate, POST /tailorings, POST /cvs/:id/prefill
 * (see RABBIT_NOTEBOOK.md for the trace that found all five). Always
 * placed AFTER ClerkGuard in the guard chain — ClerkGuard is controller-
 * scoped and Nest always runs controller-scoped guards before route-scoped
 * ones regardless of decorator order, so `request.user` is guaranteed
 * populated (from a verified Clerk JWT, never a client-supplied header)
 * by the time this guard runs.
 *
 * Runs, and can reject, BEFORE the route handler is ever invoked — so a
 * rejection here happens strictly before the controller method that would
 * enqueue the AI job / make the synchronous OpenAI call (CV prefill) and
 * before any BillingService plan-quota check or usage recording inside
 * it. This is a Nest framework guarantee (guards gate handler invocation
 * entirely), not something this class has to implement itself.
 */
@Injectable()
export class AiRateLimitGuard implements CanActivate {
  private readonly logger = new Logger(AiRateLimitGuard.name);

  constructor(
    private readonly rateLimitService: AiRateLimitService,
    @Inject(AI_RATE_LIMIT_OPTIONS) private readonly options: AiRateLimitOptions,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request & { user?: { clerkId?: string } }>();
    const response = context.switchToHttp().getResponse<Response>();

    // ClerkGuard always runs first (see this class's own doc comment) and
    // throws UnauthorizedException itself if the token is missing/invalid
    // — so request.user is unreachable-in-practice here. Failing closed
    // rather than falling back to some other identifier (IP, a header)
    // keeps every admitted request attributable to a real verified user,
    // per "identify users from trusted authentication context" — this
    // guard must never count/limit by anything a client can spoof.
    const clerkId = request.user?.clerkId;
    if (!clerkId) {
      throw new UnauthorizedException('Missing authenticated user context');
    }

    let result: { allowed: boolean; retryAfterMs: number };
    try {
      result = await this.rateLimitService.checkAndRecord(clerkId, this.options);
    } catch (err) {
      // Fail CLOSED: if Redis itself can't be reached, an unbounded
      // number of paid AI requests could otherwise go completely
      // unthrottled — the one failure mode this guard exists to prevent.
      // Scoped to only these five AI routes; every other endpoint in the
      // app (including the rest of each of these same controllers) is
      // unaffected by a Redis outage here.
      this.logger.error(
        `AI rate limit check failed, likely Redis unavailable: ${err instanceof Error ? err.message : String(err)}`,
      );
      throw new ServiceUnavailableException(
        'AI features are temporarily unavailable. Please try again in a moment.',
      );
    }

    if (result.allowed) return true;

    const retryAfterSeconds = Math.max(1, Math.ceil(result.retryAfterMs / 1000));
    response.setHeader('Retry-After', String(retryAfterSeconds));
    // A plain string `message` (not an array/nested object) matches every
    // other business-logic rejection in this API (e.g. BillingService's
    // quota messages) and is exactly what apps/web's throwApiError already
    // surfaces to the user verbatim, for any non-2xx status — no frontend
    // change needed for this message to actually reach the user.
    throw new HttpException(
      {
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        message: `You've reached the limit of ${this.options.limit} AI requests per ${Math.round(
          this.options.windowMs / 60000,
        )} minutes. Please try again in ${retryAfterSeconds} second${retryAfterSeconds === 1 ? '' : 's'}.`,
        error: 'Too Many Requests',
        retryAfterSeconds,
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}
