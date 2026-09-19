import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { randomUUID } from 'node:crypto';

// bullmq types queue.client as its own minimal IRedisClient interface,
// which omits set/eval even though the runtime value is a real ioredis
// client — same narrow cast HealthController/AiRateLimitService already
// use for the same reason.
interface LockRedisClient {
  set(key: string, value: string, mode: 'PX', ttl: number, flag: 'NX'): Promise<string | null>;
  eval(...args: unknown[]): Promise<number>;
}

/**
 * A small, generic Redis distributed-lock primitive (RABBIT_NOTEBOOK.md
 * §28) — SET NX to acquire, a check-then-delete Lua script to release
 * (never clears a DIFFERENT holder's lock, e.g. one acquired after this
 * one's TTL already expired), and an optional renewal heartbeat for
 * operations whose real duration isn't tightly bounded (the reason this
 * exists at all: §27's original per-upload prefill lock used a fixed 60s
 * TTL with no renewal, which — verified directly, see
 * prefill-lock.service.spec.ts — could expire out from under a
 * genuinely-still-running operation, letting a second caller acquire the
 * "same" lock while the first is still working).
 *
 * Used by CvService for two DIFFERENT locks: a long-lived, heartbeat-
 * renewed per-upload lock around the AI extraction call itself, and a
 * short-lived, no-heartbeat per-user lock around the builder-CV quota
 * check-then-insert (no AI call inside it, so a fixed TTL is fine there).
 * `queue` is the already-registered `cv-parsing` BullMQ queue, used purely
 * for its `.client` (a real ioredis connection on the app's own
 * REDIS_URL) — the same "no new package, no hand-rolled ioredis client"
 * convention AiRateLimitService/HealthController already established.
 */
@Injectable()
export class PrefillLockService {
  constructor(@InjectQueue('cv-parsing') private readonly queue: Queue) {}

  /** Attempts to acquire `key` for `ttlMs`. Returns the lock's token (pass
   *  it to `renew`/`release`) if acquired, or `null` if someone else
   *  already holds it. */
  async acquire(key: string, ttlMs: number): Promise<string | null> {
    const token = randomUUID();
    const client = await this.client();
    const result = await client.set(key, token, 'PX', ttlMs, 'NX');
    return result === 'OK' ? token : null;
  }

  /** Extends `key`'s TTL to `ttlMs` from now, but ONLY if it's still held
   *  by `token` — a lock that has already expired and been re-acquired by
   *  someone else is never touched. Returns whether the renewal actually
   *  applied. */
  async renew(key: string, token: string, ttlMs: number): Promise<boolean> {
    const client = await this.client();
    const result = await client.eval(RENEW_SCRIPT, 1, key, token, ttlMs);
    return result === 1;
  }

  /** Releases `key`, but ONLY if it's still held by `token` — see `renew`. */
  async release(key: string, token: string): Promise<void> {
    const client = await this.client();
    await client.eval(RELEASE_SCRIPT, 1, key, token);
  }

  /** Starts a renewal heartbeat for a lock the caller already holds,
   *  firing every `intervalMs` for as long as the operation it's
   *  protecting is still genuinely in progress — refreshing the lock's
   *  TTL well before it would otherwise expire. Returns a stop function;
   *  the caller MUST call it (typically in a `finally`, alongside
   *  `release`) once the protected operation finishes, success or not.
   *  If the process crashes instead, the heartbeat simply stops firing
   *  and the lock still expires on its own after `ttlMs` — this is a
   *  liveness aid, not a replacement for the TTL's own crash safety. */
  startHeartbeat(key: string, token: string, ttlMs: number, intervalMs: number): () => void {
    const timer = setInterval(() => {
      this.renew(key, token, ttlMs).catch(() => {
        // Best-effort: a single missed renewal isn't fatal on its own —
        // the next tick (well before the TTL margin this class is
        // designed around) gets another chance. The caller's own
        // operation, not this heartbeat, is what ultimately succeeds or
        // fails; a Redis blip here shouldn't abort in-flight AI work.
      });
    }, intervalMs);
    // Never lets this interval keep the Node process alive on its own.
    timer.unref?.();
    return () => clearInterval(timer);
  }

  private async client(): Promise<LockRedisClient> {
    return (await this.queue.client) as unknown as LockRedisClient;
  }
}

const RENEW_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('PEXPIRE', KEYS[1], ARGV[2])
end
return 0
`;

const RELEASE_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`;
