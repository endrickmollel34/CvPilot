import { Test, type TestingModule } from '@nestjs/testing';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { getRepositoryToken, getDataSourceToken } from '@nestjs/typeorm';
import { ForbiddenException } from '@nestjs/common';

import { CvService } from './cv.service';
import { PrefillExtractionService } from './prefill-extraction.service';
import { PrefillLockService } from './prefill-lock.service';
import { PdfGenerationService } from './pdf-generation.service';
import { CvPhotoService } from './cv-photo.service';
import { CvEntity } from '../../entities/cv.entity';
import { UserService } from '../user/user.service';
import { BillingService } from '../billing/billing.service';
import { R2StorageService } from '../../common/services/r2-storage.service';
import { QUEUE_JOB_RETENTION } from '../../common/constants/queue-retention';
import { PLAN_LIMITS } from '@cvpilot/shared';

/**
 * RABBIT_NOTEBOOK.md §28, "case 2": can two DIFFERENT builder-CV-creating
 * operations for the SAME user (two different uploads both prefilled, or
 * a manual createBuilder() racing a prefillFromUpload()) both slip past
 * PLAN_LIMITS.builderCvsTotal? checkBuilderCvLimit() was always a plain,
 * unprotected count-then-decide with no lock of its own — §27's
 * per-uploadCvId lock only ever covers races WITHIN one upload, never
 * across two different uploads or across createBuilder/prefillFromUpload.
 *
 * This file has two parts: a CONTROL demonstrating the exact mechanism of
 * the gap in isolation (the same naive count-then-insert pattern
 * checkBuilderCvLimit's callers used before this session, run
 * concurrently, with no lock at all), and then real concurrency tests of
 * the ACTUAL FIX (CvService.withBuilderCvQuotaLock, now used by both
 * createBuilder() and prefillFromUpload()) against real local Redis.
 */

const MOCK_USER = { id: 'user-1', clerkId: 'clerk-1' };

describe('Builder-CV quota — cross-path concurrency (RABBIT_NOTEBOOK.md §28)', () => {
  // ─── Control: the gap's mechanism, demonstrated with no lock at all ──────
  // Not CvService — a standalone reproduction of the exact "count rows,
  // then (later) insert one" shape checkBuilderCvLimit's own callers used
  // before this session, so the race is shown directly rather than argued
  // from reading the (now-fixed) source alone.

  it('CONTROL / DEMONSTRATED GAP: two concurrent naive "count-then-insert" operations both pass a limit=1 check and both insert, ending with 2 rows', async () => {
    const rows: Array<{ id: string }> = [];
    let nextId = 1;

    async function naiveCreateUnderLimit(limit: number): Promise<void> {
      // Mirrors exactly what checkBuilderCvLimit() + the subsequent
      // cvRepo.save() used to do, with nothing serializing the two: read
      // the count, decide, and only THEN (after an intentional tick, to
      // model the real gap between a DB count query and a later insert —
      // e.g. an AI call in between, or simply two requests interleaving
      // at the database) perform the insert.
      const count = rows.length;
      if (count >= limit) throw new ForbiddenException('Builder CV limit reached.');
      await new Promise((resolve) => setTimeout(resolve, 20));
      rows.push({ id: `cv-${nextId++}` });
    }

    const results = await Promise.allSettled([naiveCreateUnderLimit(1), naiveCreateUnderLimit(1)]);

    // Demonstrates the gap: a limit of 1 was silently bypassed — BOTH
    // calls read count=0 before either had inserted, so BOTH proceeded.
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
    expect(rows.length).toBe(2);
  });

  // ─── The fix, proven against real CvService + real local Redis ──────────

  let moduleRef: TestingModule;
  let service: CvService;
  let rows: Array<{ id: string; source: string }>;
  let nextId: number;

  const MOCK_UPLOAD_A = {
    id: 'cv-upload-A',
    userId: 'user-1',
    source: 'upload',
    parseStatus: 'done',
    parsedContent: 'Some CV text A',
  };
  const MOCK_UPLOAD_B = {
    id: 'cv-upload-B',
    userId: 'user-1',
    source: 'upload',
    parseStatus: 'done',
    parsedContent: 'Some CV text B',
  };

  beforeEach(async () => {
    rows = [];
    nextId = 1;

    const mockRepo = {
      findOne: jest.fn(async ({ where }: { where: Record<string, unknown> }) => {
        if (where['id'] === 'cv-upload-A') return MOCK_UPLOAD_A;
        if (where['id'] === 'cv-upload-B') return MOCK_UPLOAD_B;
        if (where['sourceUploadCvId']) {
          return (
            rows.find(
              (r) =>
                (r as { sourceUploadCvId?: unknown }).sourceUploadCvId ===
                where['sourceUploadCvId'],
            ) ?? null
          );
        }
        return null;
      }),
      create: jest.fn((data: Record<string, unknown>) => data),
      save: jest.fn(async (data: Record<string, unknown>) => {
        const row = { ...data, id: `cv-${nextId++}` } as { id: string; source: string };
        rows.push(row);
        return row;
      }),
      count: jest.fn(
        async () => rows.filter((r) => r.source === 'builder' || r.source === 'prefill').length,
      ),
    };

    const mockConfig = {
      getOrThrow: jest.fn((key: string) => {
        const vals: Record<string, string> = {
          CLOUDFLARE_R2_ENDPOINT: 'https://r2.example.com',
          CLOUDFLARE_R2_ACCESS_KEY_ID: 'key',
          CLOUDFLARE_R2_SECRET_ACCESS_KEY: 'secret',
          CLOUDFLARE_R2_BUCKET_NAME: 'bucket',
          REDIS_URL: process.env['REDIS_URL'] ?? 'redis://localhost:6379',
        };
        return vals[key] ?? '';
      }),
      get: jest.fn(() => undefined),
    };

    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        BullModule.forRootAsync({
          inject: [ConfigService],
          useFactory: (config: ConfigService) => ({
            connection: { url: config.getOrThrow<string>('REDIS_URL') },
          }),
        }),
        BullModule.registerQueue({ name: 'cv-parsing', defaultJobOptions: QUEUE_JOB_RETENTION }),
      ],
      providers: [
        CvService,
        { provide: getRepositoryToken(CvEntity), useValue: mockRepo },
        { provide: ConfigService, useValue: mockConfig },
        {
          provide: UserService,
          useValue: { findByClerkId: jest.fn().mockResolvedValue(MOCK_USER) },
        },
        // Free plan throughout this file — builderCvsTotal: 1 — the ONLY
        // tier with a finite limit today, and therefore the only one
        // where withBuilderCvQuotaLock's lock is ever actually engaged.
        { provide: BillingService, useValue: { getUserPlan: jest.fn().mockResolvedValue('free') } },
        {
          provide: PrefillExtractionService,
          useValue: {
            extract: jest.fn().mockImplementation(
              () =>
                new Promise((resolve) =>
                  setTimeout(
                    () =>
                      resolve({
                        content: {
                          version: 1,
                          personalDetails: { fullName: 'X', email: 'x@example.com' },
                          workExperience: [],
                          education: [],
                          skills: [],
                          languages: [],
                          certifications: [],
                          sectionOrder: ['summary'],
                        },
                        modelUsed: 'gpt-4o-mini',
                        tokensUsed: 10,
                        version: 1,
                      }),
                    30,
                  ),
                ),
            ),
          },
        },
        PrefillLockService,
        { provide: PdfGenerationService, useValue: { generate: jest.fn() } },
        { provide: CvPhotoService, useValue: { getPhotoBytes: jest.fn() } },
        { provide: R2StorageService, useValue: { deleteObject: jest.fn() } },
        { provide: getDataSourceToken(), useValue: { transaction: jest.fn() } },
      ],
    }).compile();

    service = moduleRef.get(CvService);
  });

  afterEach(async () => {
    await moduleRef.close();
  });

  it('FIX VERIFIED: two concurrent createBuilder() calls for a Free user (limit 1) only let one succeed', async () => {
    expect(PLAN_LIMITS.free.builderCvsTotal).toBe(1); // this test's whole premise

    const results = await Promise.allSettled([
      service.createBuilder('clerk-1', { title: 'CV A' }),
      service.createBuilder('clerk-1', { title: 'CV B' }),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(ForbiddenException);
    expect(rows.length).toBe(1); // the actual database state — never 2
  });

  it('FIX VERIFIED: a createBuilder() and a prefillFromUpload() (different upload) racing for a Free user only let one succeed', async () => {
    const results = await Promise.allSettled([
      service.createBuilder('clerk-1', { title: 'Manual CV' }),
      service.prefillFromUpload('clerk-1', 'cv-upload-A'),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(ForbiddenException);
    expect(rows.length).toBe(1);
  });

  it('FIX VERIFIED: two concurrent prefillFromUpload() calls for two DIFFERENT uploads racing for a Free user only let one succeed', async () => {
    const results = await Promise.allSettled([
      service.prefillFromUpload('clerk-1', 'cv-upload-A'),
      service.prefillFromUpload('clerk-1', 'cv-upload-B'),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(ForbiddenException);
    expect(rows.length).toBe(1);
  });
});
