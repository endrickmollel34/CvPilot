import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { randomBytes } from 'node:crypto';

import type { AiRateLimitOptions } from './ai-rate-limit.constants';

/**
 * Sliding-window-log rate limiter, backed by one Redis sorted set per
 * identity key (`ai-rate-limit:<key>`) — the sorted-set member is a
 * unique-per-request token, its score the admission timestamp (ms). A
 * single Lua script does all of the following as ONE atomic Redis
 * operation (Redis executes an entire script without interleaving any
 * other client's commands, which is exactly what "concurrent requests and
 * multiple API instances share the same limit" requires — two API
 * instances racing to admit the 5th request can't both succeed, since
 * there is no read-then-write gap for a second EVAL to land in):
 *
 *   1. ZREMRANGEBYSCORE — drop every entry older than (now - windowMs),
 *      i.e. entries that have aged out of the trailing window.
 *   2. ZCARD — count what's left (= admitted requests still inside the
 *      window).
 *   3. If count < limit: ZADD the new entry, PEXPIRE the whole key to
 *      windowMs (so an inactive user's key disappears on its own — no
 *      cleanup job needed), return admitted.
 *   4. Otherwise: read the OLDEST remaining entry's score and return
 *      rejected + how many ms until it ages out (= the real Retry-After).
 *
 * Deliberately a sliding-window LOG, not a fixed-window counter or a
 * smoothed token bucket: "five requests in any rolling ten-minute window"
 * is an exact statement about a trailing window, and a fixed-window
 * counter would let up to 2x the limit through across a window boundary
 * (5 late in window N, 5 early in window N+1, 10 within a few seconds of
 * each other). The only real cost is O(limit) space per user — trivial at
 * limit=5 — and the ZREMRANGEBYSCORE pass, both negligible at this volume.
 *
 * `queue` is an INJECTED, ALREADY-REGISTERED BullMQ queue purely for its
 * `.client` (a real ioredis connection using the same REDIS_URL config
 * already defined in AppModule's BullModule.forRootAsync) — the same
 * "no new package, no hand-rolled ioredis client" convention
 * HealthController already established for the identical reason. This
 * service only ever calls `redis.eval`; it never touches the queue as a
 * job queue.
 */
@Injectable()
export class AiRateLimitService {
  constructor(@InjectQueue('cv-analysis') private readonly queue: Queue) {}

  /**
   * Attempts to admit one request for `identityKey` under `options`.
   * Throws if Redis itself is unreachable/errors — callers (AiRateLimitGuard)
   * are expected to translate that into "temporarily unavailable" rather
   * than silently allowing the request through (fail CLOSED, not open, for
   * a cost-control guard whose entire purpose is preventing unbounded paid
   * AI usage).
   */
  async checkAndRecord(
    identityKey: string,
    options: AiRateLimitOptions,
  ): Promise<{ allowed: boolean; retryAfterMs: number }> {
    const client = await this.queue.client;
    const now = Date.now();
    // Score (now) alone isn't a valid unique ZSET member — two requests
    // landing in the same millisecond would collide and only count once.
    // The random suffix guarantees uniqueness; the score is what the
    // window logic actually reads.
    const member = `${now}-${randomBytes(6).toString('hex')}`;
    const key = `ai-rate-limit:${identityKey}`;

    // bullmq types queue.client as its own minimal IRedisClient interface,
    // which omits `eval` even though the runtime value is a real ioredis
    // client — same narrow cast HealthController already uses for `.ping`.
    const raw = await (
      client as unknown as { eval(...args: unknown[]): Promise<[number, number]> }
    ).eval(RATE_LIMIT_SCRIPT, 1, key, now, options.windowMs, options.limit, member);

    const [allowed, retryAfterMs] = raw;
    return { allowed: allowed === 1, retryAfterMs };
  }
}

const RATE_LIMIT_SCRIPT = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
local member = ARGV[4]

redis.call('ZREMRANGEBYSCORE', key, '-inf', now - window)
local count = redis.call('ZCARD', key)

if count < limit then
  redis.call('ZADD', key, now, member)
  redis.call('PEXPIRE', key, window)
  return {1, 0}
end

local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
local oldestScore = tonumber(oldest[2])
local retryAfterMs = (oldestScore + window) - now
if retryAfterMs < 0 then
  retryAfterMs = 0
end
return {0, retryAfterMs}
`;
