import { Test, type TestingModule } from '@nestjs/testing';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { getRepositoryToken, getDataSourceToken } from '@nestjs/typeorm';
import { ConflictException } from '@nestjs/common';

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
import type { CvContent } from '@cvpilot/shared';

/**
 * The mocked-Redis tests in cv-prefill.service.spec.ts prove the LOGIC of
 * the RABBIT_NOTEBOOK.md §27 per-upload lock (calls SET NX, honors its
 * result, releases via the check-then-delete script) but, being mocked,
 * can't prove the lock is actually race-safe under real concurrent
 * access — the exact thing this guard exists for. This file fires two
 * GENUINELY concurrent `prefillFromUpload` calls for the SAME uploadCvId
 * against REAL local Redis (same technique as
 * ai-rate-limit.service.spec.ts's own concurrency proof) with only the AI
 * call itself mocked, and checks the one invariant that actually matters:
 * the paid extraction call happens AT MOST ONCE.
 *
 * Deliberately does not assert which specific caller "wins" (one settling
 * with a CV, the other with ConflictException) — depending on exactly how
 * the two calls interleave, the second racer can just as validly land on
 * the POST-LOCK re-check and reuse the first's result instead of hitting
 * the lock at all. Both outcomes are correct; the only outcome that would
 * be a bug is the AI extraction firing twice.
 */
describe('CvService.prefillFromUpload — real-Redis concurrency (RABBIT_NOTEBOOK.md §27)', () => {
  const MOCK_USER = { id: 'user-1', clerkId: 'clerk-1', plan: 'free' };
  const MOCK_UPLOAD_CV: Partial<CvEntity> = {
    id: 'cv-upload-1',
    userId: 'user-1',
    source: 'upload',
    parseStatus: 'done',
    parsedContent: 'Jane Doe\njane@example.com\nSoftware Engineer at Acme Corp',
    fileName: 'jane_cv.pdf',
    title: undefined,
  };
  const MOCK_EXTRACTED_CONTENT: CvContent = {
    version: 1,
    personalDetails: {
      fullName: 'Jane Doe',
      email: 'jane@example.com',
      jobTitle: 'Software Engineer',
    },
    workExperience: [],
    education: [],
    skills: [],
    languages: [],
    certifications: [],
    sectionOrder: [
      'summary',
      'workExperience',
      'education',
      'skills',
      'languages',
      'certifications',
    ],
  };

  let service: CvService;
  let moduleRef: TestingModule;
  let extractMock: jest.Mock;
  let savedCv: (Partial<CvEntity> & { id: string }) | null;

  beforeEach(async () => {
    savedCv = null;
    extractMock = jest.fn().mockImplementation(
      () =>
        // A small real delay (not instant) so both racing calls have a
        // genuine window to be mid-flight simultaneously, closer to a
        // real OpenAI round trip than a same-tick mock resolution.
        new Promise((resolve) =>
          setTimeout(
            () =>
              resolve({
                content: MOCK_EXTRACTED_CONTENT,
                modelUsed: 'gpt-4o-mini',
                tokensUsed: 250,
                version: 1,
              }),
            50,
          ),
        ),
    );

    // Stateful in-memory mock: models the SAME two query shapes
    // prefillFromUpload actually issues (lookup the upload CV by id;
    // separately look up any existing prefill CV by sourceUploadCvId) —
    // needed because, unlike the sequential mockResolvedValueOnce chains
    // in cv-prefill.service.spec.ts, real concurrent calls interleave in
    // an order this test can't predict or fix in advance.
    const mockRepo = {
      findOne: jest.fn(async ({ where }: { where: { id?: string; sourceUploadCvId?: string } }) => {
        if (where.id === 'cv-upload-1') return MOCK_UPLOAD_CV;
        if (where.sourceUploadCvId === 'cv-upload-1') return savedCv;
        return null;
      }),
      create: jest.fn((data: Partial<CvEntity>) => data),
      save: jest.fn(async (data: Partial<CvEntity>) => {
        savedCv = { ...data, id: 'cv-prefill-1' };
        return savedCv;
      }),
      count: jest.fn().mockResolvedValue(0),
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
        {
          provide: BillingService,
          useValue: {
            canPerformAction: jest.fn(),
            getUserPlan: jest.fn().mockResolvedValue('pro'),
          },
        },
        { provide: PrefillExtractionService, useValue: { extract: extractMock } },
        // The REAL class, not a mock — this file's whole point is testing
        // against genuine concurrent Redis access, and PrefillLockService
        // needs nothing beyond the already-real 'cv-parsing' queue above.
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

  it('two genuinely concurrent prefill requests for the same upload call the paid AI extraction at most once', async () => {
    const results = await Promise.allSettled([
      service.prefillFromUpload('clerk-1', 'cv-upload-1'),
      service.prefillFromUpload('clerk-1', 'cv-upload-1'),
    ]);

    // The one invariant that actually matters: never double-pay for the
    // same upload's extraction.
    expect(extractMock).toHaveBeenCalledTimes(1);

    // Both settle cleanly — no unexpected crash — and whichever one didn't
    // win outright either reused the result (fulfilled) or got the
    // documented, expected rejection (ConflictException). Anything else
    // would indicate the lock/re-check logic broke down under real
    // concurrency rather than behaving as designed.
    for (const result of results) {
      if (result.status === 'rejected') {
        expect(result.reason).toBeInstanceOf(ConflictException);
      } else {
        expect(result.value).toMatchObject({ id: 'cv-prefill-1', source: 'prefill' });
      }
    }

    // At least one caller must have actually succeeded — this isn't a
    // test where both are allowed to fail.
    expect(results.some((r) => r.status === 'fulfilled')).toBe(true);
  });
});
