import { Test, type TestingModule } from '@nestjs/testing';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';

import { PrefillLockService } from './prefill-lock.service';

/**
 * Exercises the raw lock primitive against REAL local Redis (same
 * technique as ai-rate-limit.service.spec.ts) — ms-scale TTLs, no AI, no
 * CvService involved, so this stays fast and fully isolated from the rest
 * of the prefill flow.
 *
 * The first two tests specifically DEMONSTRATE the gap RABBIT_NOTEBOOK.md
 * §28 fixes: §27's original per-upload lock had a fixed TTL and NO
 * renewal, so an operation that genuinely ran longer than the TTL had
 * its lock silently vanish out from under it. This is shown directly —
 * acquire, wait past the TTL with no renewal, try to acquire again — a
 * real, reproducible expiry-during-use case, not a hypothetical one.
 */
describe('PrefillLockService (real local Redis)', () => {
  let service: PrefillLockService;
  let moduleRef: TestingModule;

  const uniqueKey = (label: string) =>
    `test-lock-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

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
        BullModule.registerQueue({ name: 'cv-parsing' }),
      ],
      providers: [PrefillLockService],
    }).compile();

    service = moduleRef.get(PrefillLockService);
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  // ─── Demonstrating the gap a fixed TTL with no renewal has ─────────────

  it('DEMONSTRATED GAP: a lock with no renewal can be re-acquired by someone else once its fixed TTL elapses, even if the original holder is still "working"', async () => {
    const key = uniqueKey('no-renewal');
    const firstToken = await service.acquire(key, 150);
    expect(firstToken).not.toBeNull();

    // A second, concurrent attempt while the lock is still fresh correctly fails.
    const stillHeld = await service.acquire(key, 150);
    expect(stillHeld).toBeNull();

    // Simulates the first holder's operation still being in progress well
    // past its own lock's TTL (e.g. a slow AI call) — no renewal happens.
    await new Promise((resolve) => setTimeout(resolve, 250));

    // The lock silently expired despite the "operation" not being done —
    // a second caller can now acquire the SAME key.
    const secondToken = await service.acquire(key, 150);
    expect(secondToken).not.toBeNull();
    expect(secondToken).not.toBe(firstToken);
  });

  it("release never clears a DIFFERENT holder's lock (e.g. one acquired after this token's own TTL already expired)", async () => {
    const key = uniqueKey('stale-release');
    const firstToken = await service.acquire(key, 100);
    expect(firstToken).not.toBeNull();

    await new Promise((resolve) => setTimeout(resolve, 200)); // let it expire
    const secondToken = await service.acquire(key, 5000);
    expect(secondToken).not.toBeNull();

    // The FIRST (now-stale) token's release call must be a safe no-op —
    // never delete the SECOND holder's still-active lock.
    await service.release(key, firstToken as string);

    const thirdAttempt = await service.acquire(key, 5000);
    expect(thirdAttempt).toBeNull(); // still held by the second token
  });

  // ─── The fix: a renewal heartbeat keeps a lock alive past its own fixed TTL ──

  it('FIX VERIFIED: a renewal heartbeat keeps a lock held past what its original fixed TTL alone would have allowed', async () => {
    const key = uniqueKey('with-heartbeat');
    const token = await service.acquire(key, 150);
    expect(token).not.toBeNull();

    const stopHeartbeat = service.startHeartbeat(key, token as string, 150, 40);

    // Wait well past the ORIGINAL 150ms TTL — without renewal (proven
    // above) the lock would already be gone by now.
    await new Promise((resolve) => setTimeout(resolve, 500));

    const stillBlocked = await service.acquire(key, 150);
    expect(stillBlocked).toBeNull(); // still held — the heartbeat kept renewing it

    stopHeartbeat();
    await service.release(key, token as string);

    const nowFree = await service.acquire(key, 150);
    expect(nowFree).not.toBeNull(); // correctly released once the heartbeat stopped
  });

  it('renew only extends a lock still held by the given token, never one that already expired and was re-acquired', async () => {
    const key = uniqueKey('renew-ownership');
    const firstToken = await service.acquire(key, 100);
    expect(firstToken).not.toBeNull();

    await new Promise((resolve) => setTimeout(resolve, 200)); // let it expire
    const secondToken = await service.acquire(key, 5000);
    expect(secondToken).not.toBeNull();

    const renewed = await service.renew(key, firstToken as string, 5000);
    expect(renewed).toBe(false); // the stale token owns nothing anymore

    // The second holder's lock must be completely unaffected.
    const stillBlockedForOthers = await service.acquire(key, 100);
    expect(stillBlockedForOthers).toBeNull();
  });
});
