import { readFileSync } from 'fs';
import { join } from 'path';

import { QUEUE_JOB_RETENTION } from './queue-retention';

// Privacy P1 — BullMQ/Redis job retention. Registering `defaultJobOptions`
// via a NestJS dynamic module isn't practically unit-testable without a real
// Redis connection (nothing else in this codebase attempts that), so this
// tests the smallest exported unit instead: the shared retention config
// object every registerQueue() call site imports and applies identically.
describe('QUEUE_JOB_RETENTION', () => {
  // Not an { age, count } KeepJobs object: BullMQ's age-based cleanup is
  // lazy (an expired job is only evicted once a LATER job of the same kind
  // finishes), which cannot guarantee removal for a low-volume queue. `true`
  // removes a job immediately once it reaches its terminal state (completed,
  // or failed after all attempts are exhausted) — no dependency on a
  // subsequent job arriving to trigger the sweep.
  it('removes completed jobs immediately, not on a lazy age/count schedule', () => {
    expect(QUEUE_JOB_RETENTION.removeOnComplete).toBe(true);
  });

  it('removes terminally-failed jobs immediately, not on a lazy age/count schedule', () => {
    expect(QUEUE_JOB_RETENTION.removeOnFail).toBe(true);
  });

  // Structural check (no Redis, no NestJS module compilation): every module
  // that registers one of these 4 queues must import and apply
  // QUEUE_JOB_RETENTION as defaultJobOptions, so retention is consistent
  // regardless of which module's registerQueue() call NestJS resolves first
  // for the two queue names ('cv-parsing', 'cv-analysis') registered twice.
  describe('applied at every registerQueue() call site', () => {
    const REGISTERING_MODULES = [
      '../../modules/cv/cv.module.ts',
      '../../modules/parsing/parsing.module.ts',
      '../../modules/analysis/analysis.module.ts',
      '../../modules/health/health.module.ts',
      '../../modules/cover-letter/cover-letter.module.ts',
      '../../modules/tailoring/tailoring.module.ts',
    ];

    it.each(REGISTERING_MODULES)('%s imports and applies QUEUE_JOB_RETENTION', (relativePath) => {
      const source = readFileSync(join(__dirname, relativePath), 'utf8');

      expect(source).toMatch(
        /import\s*\{\s*QUEUE_JOB_RETENTION\s*\}\s*from\s*['"].*queue-retention['"]/,
      );
      expect(source).toMatch(/registerQueue\(\{[^}]*defaultJobOptions:\s*QUEUE_JOB_RETENTION/s);
    });
  });
});
