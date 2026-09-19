import { Test, type TestingModule } from '@nestjs/testing';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';

import { AiRateLimitService } from './ai-rate-limit.service';
import { AiRateLimitModule } from './ai-rate-limit.module';

/**
 * Exercises AiRateLimitService against the REAL local development Redis
 * (the same `cvpilot-redis-1` container docker compose already runs for
 * this project — same REDIS_URL the app itself reads via ConfigService),
 * not a mock — the atomicity/concurrency/expiry claims this rate limiter
 * makes are exactly the kind of thing a mocked Redis client can't actually
 * verify. Every test uses a unique, randomly-suffixed identity key so
 * parallel/repeated runs never collide with each other or with any real
 * ai-rate-limit:* key the running application itself might hold; short
 * (millisecond-scale) windows are used throughout so exhaustion/expiry
 * can be verified in real time without waiting for the production 10-
 * minute window. Every key this file creates carries a short PEXPIRE
 * (windowMs, at most 5s here) regardless of test outcome, so nothing is
 * left behind in the shared dev Redis instance beyond a few seconds.
 */
describe('AiRateLimitService (real local Redis)', () => {
  let service: AiRateLimitService;
  let moduleRef: TestingModule;

  const uniqueKey = (label: string) =>
    `test-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        BullModule.forRootAsync({
          inject: [ConfigService],
          useFactory: (config: ConfigService) => ({
            connection: { url: config.getOrThrow<string>('REDIS_URL') },
          }),
        }),
        AiRateLimitModule,
      ],
    }).compile();

    service = moduleRef.get(AiRateLimitService);
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  it('exhaustion: admits exactly `limit` requests, then rejects the next one', async () => {
    const key = uniqueKey('exhaustion');
    const opts = { limit: 3, windowMs: 5000 };

    const r1 = await service.checkAndRecord(key, opts);
    const r2 = await service.checkAndRecord(key, opts);
    const r3 = await service.checkAndRecord(key, opts);
    const r4 = await service.checkAndRecord(key, opts);

    expect([r1.allowed, r2.allowed, r3.allowed]).toEqual([true, true, true]);
    expect(r4.allowed).toBe(false);
    expect(r4.retryAfterMs).toBeGreaterThan(0);
    expect(r4.retryAfterMs).toBeLessThanOrEqual(opts.windowMs);
  });

  it('expiry: a request is admitted again once the window has fully elapsed', async () => {
    const key = uniqueKey('expiry');
    const opts = { limit: 1, windowMs: 250 };

    const first = await service.checkAndRecord(key, opts);
    expect(first.allowed).toBe(true);

    const immediatelyAfter = await service.checkAndRecord(key, opts);
    expect(immediatelyAfter.allowed).toBe(false);

    await new Promise((resolve) => setTimeout(resolve, opts.windowMs + 100));

    const afterExpiry = await service.checkAndRecord(key, opts);
    expect(afterExpiry.allowed).toBe(true);
  });

  it('separate users: two different identity keys never share a counter', async () => {
    const keyA = uniqueKey('user-a');
    const keyB = uniqueKey('user-b');
    const opts = { limit: 1, windowMs: 5000 };

    const a1 = await service.checkAndRecord(keyA, opts);
    const aRejected = await service.checkAndRecord(keyA, opts);
    // User B's own first request must still be admitted — user A
    // exhausting their limit must have zero effect on user B's counter.
    const b1 = await service.checkAndRecord(keyB, opts);

    expect(a1.allowed).toBe(true);
    expect(aRejected.allowed).toBe(false);
    expect(b1.allowed).toBe(true);
  });

  it('shared across features: the same identity key is one shared counter regardless of which caller uses it', async () => {
    // The service has no concept of "feature" at all — this test proves
    // that directly: calls representing analysis/cover-letter/tailoring/
    // prefill all pass the SAME clerkId-derived key (as AiRateLimitGuard
    // always does — see its own source), so they necessarily draw from
    // one shared budget, not four independent ones.
    const key = uniqueKey('shared-features');
    const opts = { limit: 4, windowMs: 5000 };

    const fromAnalysis = await service.checkAndRecord(key, opts);
    const fromCoverLetter = await service.checkAndRecord(key, opts);
    const fromTailoring = await service.checkAndRecord(key, opts);
    const fromPrefill = await service.checkAndRecord(key, opts);
    const fromCoverLetterRegenerate = await service.checkAndRecord(key, opts);

    expect(
      [fromAnalysis, fromCoverLetter, fromTailoring, fromPrefill].map((r) => r.allowed),
    ).toEqual([true, true, true, true]);
    // The 5th call, regardless of which "feature" it represents, is
    // rejected — proves the 4 prior calls across different call sites all
    // drew down the SAME counter, not four separate ones.
    expect(fromCoverLetterRegenerate.allowed).toBe(false);
  });

  it('concurrent requests: a burst of parallel calls admits exactly `limit`, never more', async () => {
    const key = uniqueKey('concurrent');
    const opts = { limit: 5, windowMs: 5000 };
    const burstSize = 20;

    // Promise.all fires all 20 calls essentially simultaneously — if the
    // Lua script's ZREMRANGEBYSCORE+ZCARD+ZADD sequence were not truly
    // atomic (e.g. implemented as separate round-trips with a
    // read-then-write gap), a large enough burst would race past `limit`.
    const results = await Promise.all(
      Array.from({ length: burstSize }, () => service.checkAndRecord(key, opts)),
    );

    const admittedCount = results.filter((r) => r.allowed).length;
    expect(admittedCount).toBe(opts.limit);
    expect(results.length - admittedCount).toBe(burstSize - opts.limit);
  });

  it('Redis failure: checkAndRecord rejects (never silently allows) when the connection is unusable', async () => {
    const brokenQueue = {
      client: Promise.resolve({
        eval: () => Promise.reject(new Error('connect ECONNREFUSED 127.0.0.1:1')),
      }),
    } as unknown as Queue;
    const brokenService = new AiRateLimitService(brokenQueue);

    await expect(
      brokenService.checkAndRecord(uniqueKey('redis-down'), { limit: 5, windowMs: 5000 }),
    ).rejects.toThrow();
  });
});
