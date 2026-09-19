/**
 * Pre-launch security gap closed here (RABBIT_NOTEBOOK.md): CLAUDE.md's own
 * Security Constraints document "5 AI requests per user per 10-minute
 * window (Redis token bucket)" as an existing constraint, but no code
 * anywhere implemented it — only the unrelated, global 100 req/min-per-IP
 * ThrottlerModule guard existed. Every OpenAI/Anthropic call this product
 * makes costs real money per request, so an authenticated user (or a
 * compromised/scripted account) could otherwise submit unlimited AI jobs.
 *
 * The actual algorithm is a sliding-window LOG (a per-user Redis sorted
 * set of admitted-request timestamps), not a token bucket — the two are
 * closely related rate-limiting strategies, but a sliding window log gives
 * an exact "N requests in any trailing WINDOW_MS" guarantee (what was
 * actually asked for) rather than a bucket's smoothed refill-rate
 * approximation. See ai-rate-limit.service.ts's own doc comment for the
 * full mechanics.
 */
export const AI_RATE_LIMIT_MAX_REQUESTS = 5;
export const AI_RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;

export interface AiRateLimitOptions {
  limit: number;
  windowMs: number;
}

/** DI token for the { limit, windowMs } policy AiRateLimitGuard enforces.
 *  Bound to the real 5-per-10-minutes production policy by
 *  AiRateLimitModule; tests override this token (Nest's own
 *  `overrideProvider`) with a small limit/window so exhaustion and expiry
 *  can be verified in milliseconds instead of real minutes, without ever
 *  touching the production wiring or the underlying Redis algorithm. */
export const AI_RATE_LIMIT_OPTIONS = Symbol('AI_RATE_LIMIT_OPTIONS');
