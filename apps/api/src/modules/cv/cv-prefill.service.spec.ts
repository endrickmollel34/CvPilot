import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { getRepositoryToken, getDataSourceToken } from '@nestjs/typeorm';
import { getQueueToken } from '@nestjs/bullmq';
import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ZodError } from 'zod';

import { CvService } from './cv.service';
import { PrefillExtractionService, ExtractionResponseSchema } from './prefill-extraction.service';
import { PrefillLockService } from './prefill-lock.service';
import { PdfGenerationService } from './pdf-generation.service';
import { CvPhotoService } from './cv-photo.service';
import { CvEntity } from '../../entities/cv.entity';
import { UserService } from '../user/user.service';
import { BillingService } from '../billing/billing.service';
import { R2StorageService } from '../../common/services/r2-storage.service';
import { PLAN_LIMITS } from '@cvpilot/shared';
import type { CvContent } from '@cvpilot/shared';

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
  sectionOrder: ['summary', 'workExperience', 'education', 'skills', 'languages', 'certifications'],
};

const MOCK_PREFILL_CV: Partial<CvEntity> = {
  id: 'cv-prefill-1',
  userId: 'user-1',
  source: 'prefill',
  parseStatus: 'done',
  sourceUploadCvId: 'cv-upload-1',
  content: MOCK_EXTRACTED_CONTENT,
  prefillExtractedAt: new Date('2026-08-05'),
  prefillModel: 'gpt-4o-mini',
  prefillTokensUsed: 250,
  prefillVersion: 1,
};

// ─── CvService.prefillFromUpload() ───────────────────────────────────────────

describe('CvService — prefillFromUpload()', () => {
  let service: CvService;

  const mockRepo = {
    create: jest.fn(),
    save: jest.fn(),
    update: jest.fn(),
    findOne: jest.fn(),
    findOneBy: jest.fn(),
    findOneByOrFail: jest.fn(),
    find: jest.fn(),
    count: jest.fn(),
    softDelete: jest.fn(),
  };
  const mockQueue = { add: jest.fn() };
  // Backs both the RABBIT_NOTEBOOK.md §27 per-upload prefill lock and the
  // §28 renewal heartbeat. Defaults to "lock freely acquired/released,
  // heartbeat a no-op stop function" in beforeEach so every pre-existing
  // test below, none of which cares about locking, is unaffected.
  let heartbeatStop: jest.Mock;
  const mockPrefillLockService = {
    acquire: jest.fn(),
    renew: jest.fn(),
    release: jest.fn(),
    startHeartbeat: jest.fn(),
  };
  const mockConfig = {
    getOrThrow: jest.fn((key: string) => {
      const vals: Record<string, string> = {
        CLOUDFLARE_R2_ENDPOINT: 'https://r2.example.com',
        CLOUDFLARE_R2_ACCESS_KEY_ID: 'key',
        CLOUDFLARE_R2_SECRET_ACCESS_KEY: 'secret',
        CLOUDFLARE_R2_BUCKET_NAME: 'bucket',
        OPENAI_API_KEY: 'test-key',
      };
      return vals[key] ?? '';
    }),
  };
  const mockUserService = { findByClerkId: jest.fn() };
  const mockBillingService = { canPerformAction: jest.fn(), getUserPlan: jest.fn() };
  const mockPrefillService = { extract: jest.fn() };
  const mockPdfService = { generate: jest.fn() };
  const mockR2Storage = { deleteObject: jest.fn() };
  const mockPhotoService = { getPhotoBytes: jest.fn() };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CvService,
        { provide: getRepositoryToken(CvEntity), useValue: mockRepo },
        { provide: getQueueToken('cv-parsing'), useValue: mockQueue },
        { provide: ConfigService, useValue: mockConfig },
        { provide: UserService, useValue: mockUserService },
        { provide: BillingService, useValue: mockBillingService },
        { provide: PrefillExtractionService, useValue: mockPrefillService },
        { provide: PrefillLockService, useValue: mockPrefillLockService },
        { provide: PdfGenerationService, useValue: mockPdfService },
        { provide: CvPhotoService, useValue: mockPhotoService },
        { provide: R2StorageService, useValue: mockR2Storage },
        { provide: getDataSourceToken(), useValue: { transaction: jest.fn() } },
      ],
    }).compile();

    service = module.get<CvService>(CvService);

    jest.clearAllMocks();
    mockUserService.findByClerkId.mockResolvedValue(MOCK_USER);
    mockBillingService.getUserPlan.mockResolvedValue('pro'); // no limit by default
    mockRepo.count.mockResolvedValue(0);
    heartbeatStop = jest.fn();
    mockPrefillLockService.acquire.mockResolvedValue('lock-token'); // freely acquired by default
    mockPrefillLockService.renew.mockResolvedValue(true);
    mockPrefillLockService.release.mockResolvedValue(undefined);
    mockPrefillLockService.startHeartbeat.mockReturnValue(heartbeatStop);
    mockPrefillService.extract.mockResolvedValue({
      content: MOCK_EXTRACTED_CONTENT,
      modelUsed: 'gpt-4o-mini',
      tokensUsed: 250,
      version: 1,
    });
    mockRepo.create.mockReturnValue(MOCK_PREFILL_CV);
    mockRepo.save.mockResolvedValue(MOCK_PREFILL_CV);
  });

  // ─── Ownership protection ─────────────────────────────────────────────────────

  it('throws NotFoundException when upload CV does not belong to the user', async () => {
    mockRepo.findOne.mockResolvedValueOnce(null);

    await expect(service.prefillFromUpload('clerk-1', 'cv-upload-1')).rejects.toThrow(
      NotFoundException,
    );
    expect(mockPrefillService.extract).not.toHaveBeenCalled();
  });

  // ─── Source validation ────────────────────────────────────────────────────────

  it('throws UnprocessableEntityException when CV source is not upload', async () => {
    mockRepo.findOne.mockResolvedValueOnce({ ...MOCK_UPLOAD_CV, source: 'builder' });

    await expect(service.prefillFromUpload('clerk-1', 'cv-upload-1')).rejects.toThrow(
      UnprocessableEntityException,
    );
    expect(mockPrefillService.extract).not.toHaveBeenCalled();
  });

  // ─── Parse status validation ──────────────────────────────────────────────────

  it('throws UnprocessableEntityException when CV has not finished parsing', async () => {
    mockRepo.findOne.mockResolvedValueOnce({ ...MOCK_UPLOAD_CV, parseStatus: 'processing' });

    await expect(service.prefillFromUpload('clerk-1', 'cv-upload-1')).rejects.toThrow(
      UnprocessableEntityException,
    );
    expect(mockPrefillService.extract).not.toHaveBeenCalled();
  });

  it('throws UnprocessableEntityException when parseStatus is pending', async () => {
    mockRepo.findOne.mockResolvedValueOnce({ ...MOCK_UPLOAD_CV, parseStatus: 'pending' });

    await expect(service.prefillFromUpload('clerk-1', 'cv-upload-1')).rejects.toThrow(
      UnprocessableEntityException,
    );
  });

  // ─── Empty parsed text ────────────────────────────────────────────────────────

  it('throws UnprocessableEntityException when parsedContent is empty string', async () => {
    mockRepo.findOne.mockResolvedValueOnce({ ...MOCK_UPLOAD_CV, parsedContent: '' });

    await expect(service.prefillFromUpload('clerk-1', 'cv-upload-1')).rejects.toThrow(
      UnprocessableEntityException,
    );
    expect(mockPrefillService.extract).not.toHaveBeenCalled();
  });

  it('throws UnprocessableEntityException when parsedContent is whitespace only', async () => {
    mockRepo.findOne.mockResolvedValueOnce({ ...MOCK_UPLOAD_CV, parsedContent: '   \n  ' });

    await expect(service.prefillFromUpload('clerk-1', 'cv-upload-1')).rejects.toThrow(
      UnprocessableEntityException,
    );
    expect(mockPrefillService.extract).not.toHaveBeenCalled();
  });

  it('throws UnprocessableEntityException when parsedContent is undefined', async () => {
    mockRepo.findOne.mockResolvedValueOnce({ ...MOCK_UPLOAD_CV, parsedContent: undefined });

    await expect(service.prefillFromUpload('clerk-1', 'cv-upload-1')).rejects.toThrow(
      UnprocessableEntityException,
    );
    expect(mockPrefillService.extract).not.toHaveBeenCalled();
  });

  // ─── Idempotency / caching ────────────────────────────────────────────────────

  it('returns existing prefill CV without calling AI when one already exists', async () => {
    mockRepo.findOne
      .mockResolvedValueOnce(MOCK_UPLOAD_CV) // upload CV lookup
      .mockResolvedValueOnce(MOCK_PREFILL_CV); // existing prefill CV found

    const result = await service.prefillFromUpload('clerk-1', 'cv-upload-1');

    expect(result).toEqual(MOCK_PREFILL_CV);
    expect(mockPrefillService.extract).not.toHaveBeenCalled();
    expect(mockRepo.save).not.toHaveBeenCalled();
  });

  // ─── Billing limit ────────────────────────────────────────────────────────────

  it('throws ForbiddenException when builder CV limit is reached', async () => {
    mockRepo.findOne.mockResolvedValueOnce(MOCK_UPLOAD_CV).mockResolvedValueOnce(null); // no existing prefill CV
    mockBillingService.getUserPlan.mockResolvedValue('free');
    mockRepo.count.mockResolvedValue(PLAN_LIMITS.free.builderCvsTotal);

    await expect(service.prefillFromUpload('clerk-1', 'cv-upload-1')).rejects.toThrow(
      ForbiddenException,
    );
    expect(mockPrefillService.extract).not.toHaveBeenCalled();
  });

  // ─── Successful extraction ────────────────────────────────────────────────────

  it('creates prefill CV with extracted content and tracking fields on success', async () => {
    mockRepo.findOne.mockResolvedValueOnce(MOCK_UPLOAD_CV).mockResolvedValueOnce(null);

    const result = await service.prefillFromUpload('clerk-1', 'cv-upload-1');

    expect(mockPrefillService.extract).toHaveBeenCalledWith(MOCK_UPLOAD_CV.parsedContent);
    expect(mockRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        source: 'prefill',
        parseStatus: 'done',
        isActive: true,
        content: MOCK_EXTRACTED_CONTENT,
        sourceUploadCvId: 'cv-upload-1',
        prefillModel: 'gpt-4o-mini',
        prefillTokensUsed: 250,
        prefillVersion: 1,
      }),
    );
    expect(mockRepo.save).toHaveBeenCalled();
    expect(result).toEqual(MOCK_PREFILL_CV);
  });

  it('uses upload CV fileName as title when title is absent', async () => {
    const uploadWithoutTitle = { ...MOCK_UPLOAD_CV, title: undefined, fileName: 'my_resume.pdf' };
    mockRepo.findOne.mockResolvedValueOnce(uploadWithoutTitle).mockResolvedValueOnce(null);

    await service.prefillFromUpload('clerk-1', 'cv-upload-1');

    expect(mockRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'my_resume.pdf' }),
    );
  });

  it('falls back to "Prefilled CV" title when neither title nor fileName is set', async () => {
    const uploadWithoutNames = { ...MOCK_UPLOAD_CV, title: undefined, fileName: undefined };
    mockRepo.findOne.mockResolvedValueOnce(uploadWithoutNames).mockResolvedValueOnce(null);

    await service.prefillFromUpload('clerk-1', 'cv-upload-1');

    expect(mockRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Prefilled CV' }),
    );
  });

  // ─── AI failure propagation ───────────────────────────────────────────────────

  it('propagates error when extraction service throws after all retries', async () => {
    mockRepo.findOne.mockResolvedValueOnce(MOCK_UPLOAD_CV).mockResolvedValueOnce(null);
    mockPrefillService.extract.mockRejectedValue(
      new Error('Prefill extraction failed after 3 attempts'),
    );

    await expect(service.prefillFromUpload('clerk-1', 'cv-upload-1')).rejects.toThrow(
      'Prefill extraction failed after 3 attempts',
    );
    expect(mockRepo.save).not.toHaveBeenCalled();
  });

  // ─── Concurrency lock (RABBIT_NOTEBOOK.md §27/§28) ──────────────────────────
  // The "returns existing prefill CV" test above proves SEQUENTIAL reuse —
  // a second call made AFTER the first has already saved its row. These
  // prove the previously-unguarded RACE case: two requests for the SAME
  // uploadCvId close enough together that both could otherwise read "no
  // existing row" and both call the real, paid AI extraction. (The actual
  // Redis SET NX/EVAL mechanics now live in PrefillLockService — see its
  // own real-Redis spec, prefill-lock.service.spec.ts — this file only
  // checks that CvService calls that service correctly.)

  it('acquires the per-upload lock before calling AI, starts a renewal heartbeat, and releases/stops both after success', async () => {
    mockRepo.findOne.mockResolvedValueOnce(MOCK_UPLOAD_CV).mockResolvedValueOnce(null);

    await service.prefillFromUpload('clerk-1', 'cv-upload-1');

    expect(mockPrefillLockService.acquire).toHaveBeenCalledWith(
      'prefill-lock:cv-upload-1',
      expect.any(Number),
    );
    expect(mockPrefillService.extract).toHaveBeenCalled();
    // §28: a heartbeat must be started for the lock's TTL to survive a
    // slow AI call, and stopped once the operation is actually done.
    expect(mockPrefillLockService.startHeartbeat).toHaveBeenCalledWith(
      'prefill-lock:cv-upload-1',
      'lock-token',
      expect.any(Number),
      expect.any(Number),
    );
    expect(heartbeatStop).toHaveBeenCalled();
    expect(mockPrefillLockService.release).toHaveBeenCalledWith(
      'prefill-lock:cv-upload-1',
      'lock-token',
    );
  });

  it('rejects with ConflictException and never calls AI when another request already holds the lock', async () => {
    mockRepo.findOne.mockResolvedValueOnce(MOCK_UPLOAD_CV).mockResolvedValueOnce(null);
    // acquire() returns null when the key already exists — exactly what a
    // concurrent, in-flight request for the same uploadCvId produces.
    mockPrefillLockService.acquire.mockResolvedValue(null);

    await expect(service.prefillFromUpload('clerk-1', 'cv-upload-1')).rejects.toThrow(
      ConflictException,
    );
    expect(mockPrefillService.extract).not.toHaveBeenCalled();
    expect(mockRepo.save).not.toHaveBeenCalled();
    // Never held the lock, so there is nothing for this request to
    // release, and no heartbeat to have started.
    expect(mockPrefillLockService.startHeartbeat).not.toHaveBeenCalled();
    expect(mockPrefillLockService.release).not.toHaveBeenCalled();
  });

  it('re-checks for an existing prefill CV after acquiring the lock and reuses it without calling AI (the race winner finished first)', async () => {
    // Upload lookup, then the cheap pre-lock check (still finds nothing —
    // the race is genuinely on), then the post-lock re-check — which now
    // finds the row the OTHER request (the one that actually won the lock
    // acquisition race a moment earlier) already created and committed.
    mockRepo.findOne
      .mockResolvedValueOnce(MOCK_UPLOAD_CV)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(MOCK_PREFILL_CV);

    const result = await service.prefillFromUpload('clerk-1', 'cv-upload-1');

    expect(result).toEqual(MOCK_PREFILL_CV);
    expect(mockPrefillService.extract).not.toHaveBeenCalled();
    expect(mockRepo.save).not.toHaveBeenCalled();
    // Still correctly stops the heartbeat and releases the lock it
    // acquired, even though it ended up not needing to do any AI work.
    expect(heartbeatStop).toHaveBeenCalled();
    expect(mockPrefillLockService.release).toHaveBeenCalled();
  });

  it('stops the heartbeat and releases the lock even when the AI extraction call fails, so a real retry is not blocked for the full TTL', async () => {
    mockRepo.findOne.mockResolvedValueOnce(MOCK_UPLOAD_CV).mockResolvedValueOnce(null);
    mockPrefillService.extract.mockRejectedValue(new Error('OpenAI request failed'));

    await expect(service.prefillFromUpload('clerk-1', 'cv-upload-1')).rejects.toThrow(
      'OpenAI request failed',
    );

    expect(heartbeatStop).toHaveBeenCalled();
    expect(mockPrefillLockService.release).toHaveBeenCalled();
  });

  it('stops the heartbeat and releases the lock even when the builder CV limit check fails', async () => {
    mockRepo.findOne.mockResolvedValueOnce(MOCK_UPLOAD_CV).mockResolvedValueOnce(null);
    mockBillingService.getUserPlan.mockResolvedValue('free');
    mockRepo.count.mockResolvedValue(PLAN_LIMITS.free.builderCvsTotal);

    await expect(service.prefillFromUpload('clerk-1', 'cv-upload-1')).rejects.toThrow(
      ForbiddenException,
    );

    expect(mockPrefillService.extract).not.toHaveBeenCalled();
    expect(heartbeatStop).toHaveBeenCalled();
    expect(mockPrefillLockService.release).toHaveBeenCalled();
  });
});

// ─── ExtractionResponseSchema — Zod validation ───────────────────────────────

describe('ExtractionResponseSchema', () => {
  it('defaults missing array sections to empty arrays', () => {
    const result = ExtractionResponseSchema.parse({
      personalDetails: { fullName: 'Alice', email: 'alice@example.com' },
    });
    expect(result.workExperience).toEqual([]);
    expect(result.education).toEqual([]);
    expect(result.skills).toEqual([]);
    expect(result.languages).toEqual([]);
    expect(result.certifications).toEqual([]);
  });

  it('defaults missing fullName and email to empty strings', () => {
    const result = ExtractionResponseSchema.parse({ personalDetails: {} });
    expect(result.personalDetails.fullName).toBe('');
    expect(result.personalDetails.email).toBe('');
  });

  it('throws ZodError when workExperience entry is missing required company field', () => {
    expect(() =>
      ExtractionResponseSchema.parse({
        personalDetails: { fullName: 'Alice', email: 'alice@example.com' },
        workExperience: [{ title: 'Engineer', startDate: '2023-01', current: false, bullets: [] }],
      }),
    ).toThrow(ZodError);
  });

  it('throws ZodError when workExperience entry is missing required startDate', () => {
    expect(() =>
      ExtractionResponseSchema.parse({
        personalDetails: { fullName: 'Alice', email: 'alice@example.com' },
        workExperience: [{ company: 'Acme', title: 'Engineer', current: false, bullets: [] }],
      }),
    ).toThrow(ZodError);
  });

  it('throws ZodError when education entry is missing required institution', () => {
    expect(() =>
      ExtractionResponseSchema.parse({
        personalDetails: {},
        education: [{ degree: 'BSc Computer Science' }],
      }),
    ).toThrow(ZodError);
  });

  it('accepts [?] prefixed values as valid uncertain extractions', () => {
    const result = ExtractionResponseSchema.parse({
      personalDetails: { fullName: 'Alice', email: 'alice@example.com', phone: '[?] +44 7700' },
      workExperience: [
        {
          company: '[?] Acme Corp',
          title: 'Engineer',
          startDate: '[?] 2023',
          current: false,
          bullets: [],
        },
      ],
    });
    expect(result.personalDetails.phone).toBe('[?] +44 7700');
    expect(result.workExperience[0]!.company).toBe('[?] Acme Corp');
  });
});
