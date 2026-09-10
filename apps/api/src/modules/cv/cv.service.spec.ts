import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { getRepositoryToken, getDataSourceToken } from '@nestjs/typeorm';
import { getQueueToken } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import {
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';

import type { CvContent } from '@cvpilot/shared';
import { CvService } from './cv.service';
import { CvEntity } from '../../entities/cv.entity';
import { UserService } from '../user/user.service';
import { BillingService } from '../billing/billing.service';
import { PrefillExtractionService } from './prefill-extraction.service';
import { PdfGenerationService } from './pdf-generation.service';
import { R2StorageService } from '../../common/services/r2-storage.service';

// S3Client is constructed unconditionally in CvService's constructor —
// mocked so tests never attempt a real R2 connection.
jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn().mockImplementation(() => ({ send: jest.fn() })),
  PutObjectCommand: jest.fn(),
  GetObjectCommand: jest.fn(),
  DeleteObjectCommand: jest.fn(),
}));
jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: jest.fn().mockResolvedValue('https://r2.example.com/signed-put-url'),
}));

const MOCK_USER = { id: 'user-1', clerkId: 'clerk-1' };

function makeConfig() {
  const vals: Record<string, string> = {
    CLOUDFLARE_R2_ENDPOINT: 'https://r2.example.com',
    CLOUDFLARE_R2_ACCESS_KEY_ID: 'key',
    CLOUDFLARE_R2_SECRET_ACCESS_KEY: 'secret',
    CLOUDFLARE_R2_BUCKET_NAME: 'bucket',
  };
  return { getOrThrow: jest.fn((key: string) => vals[key]) };
}

describe('CvService — confirmUpload() ownership validation', () => {
  let service: CvService;

  const mockCvRepo = { create: jest.fn(), save: jest.fn() };
  const mockQueue = { add: jest.fn() };
  const mockUserService = { findByClerkId: jest.fn() };
  const mockBillingService = { canPerformAction: jest.fn() };
  const mockPrefillService = {};
  const mockPdfService = {};

  const validDto = {
    r2ObjectKey: `cvs/${MOCK_USER.id}/some-uuid-resume.pdf`,
    fileName: 'resume.pdf',
    fileSizeBytes: 1024,
    mimeType: 'application/pdf',
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CvService,
        { provide: getRepositoryToken(CvEntity), useValue: mockCvRepo },
        { provide: getQueueToken('cv-parsing'), useValue: mockQueue },
        { provide: ConfigService, useValue: makeConfig() },
        { provide: UserService, useValue: mockUserService },
        { provide: BillingService, useValue: mockBillingService },
        { provide: PrefillExtractionService, useValue: mockPrefillService },
        { provide: PdfGenerationService, useValue: mockPdfService },
        { provide: R2StorageService, useValue: { deleteObject: jest.fn() } },
        { provide: getDataSourceToken(), useValue: { transaction: jest.fn() } },
      ],
    }).compile();

    service = module.get<CvService>(CvService);

    mockUserService.findByClerkId.mockResolvedValue(MOCK_USER);
    mockCvRepo.create.mockImplementation((data: unknown) => data);
    mockCvRepo.save.mockImplementation((data: unknown) =>
      Promise.resolve({ id: 'cv-1', ...(data as object) }),
    );
    mockQueue.add.mockResolvedValue({ id: 'job-1' });
  });

  it("accepts a key within the authenticated user's own namespace", async () => {
    const result = await service.confirmUpload('clerk-1', validDto);

    expect(mockCvRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ userId: MOCK_USER.id, r2ObjectKey: validDto.r2ObjectKey }),
    );
    expect(mockCvRepo.save).toHaveBeenCalled();
    expect(mockQueue.add).toHaveBeenCalledWith('parse-cv', { cvId: 'cv-1' });
    expect(result).toEqual(expect.objectContaining({ r2ObjectKey: validDto.r2ObjectKey }));
  });

  it("rejects a key inside another user's namespace", async () => {
    const foreignKeyDto = {
      ...validDto,
      r2ObjectKey: 'cvs/some-other-user-id/leaked-uuid-resume.pdf',
    };

    await expect(service.confirmUpload('clerk-1', foreignKeyDto)).rejects.toThrow(
      ForbiddenException,
    );
    expect(mockCvRepo.create).not.toHaveBeenCalled();
    expect(mockCvRepo.save).not.toHaveBeenCalled();
    expect(mockQueue.add).not.toHaveBeenCalled();
  });

  it('rejects a malformed key with no cvs/ prefix at all', async () => {
    const malformedDto = { ...validDto, r2ObjectKey: 'not-a-real-object-key' };

    await expect(service.confirmUpload('clerk-1', malformedDto)).rejects.toThrow(
      ForbiddenException,
    );
    expect(mockCvRepo.create).not.toHaveBeenCalled();
  });

  it("rejects a key whose prefix merely starts with this user's id (no path separator) — prevents a UUID-prefix collision bypass", async () => {
    // e.g. another real user id happens to start with this user's id as a
    // string prefix; without requiring the trailing "/", startsWith() alone
    // would wrongly accept this.
    const collisionDto = {
      ...validDto,
      r2ObjectKey: `cvs/${MOCK_USER.id}-extra-suffix/resume.pdf`,
    };

    await expect(service.confirmUpload('clerk-1', collisionDto)).rejects.toThrow(
      ForbiddenException,
    );
    expect(mockCvRepo.create).not.toHaveBeenCalled();
  });

  it('does not leak whether a foreign key exists — throws a generic message', async () => {
    const foreignKeyDto = {
      ...validDto,
      r2ObjectKey: 'cvs/some-other-user-id/leaked-uuid-resume.pdf',
    };

    await expect(service.confirmUpload('clerk-1', foreignKeyDto)).rejects.toMatchObject({
      message: expect.not.stringContaining('some-other-user-id') as unknown as string,
    });
  });
});

// ─── CV Template Foundation, Phase 1 — template persistence ────────────────
// templateId is presentation metadata, deliberately separate from
// `content` — these tests prove that separation actually holds at the
// service layer, not just by inspection of the entity/DTO shapes.
describe('CvService — template persistence', () => {
  let service: CvService;

  const mockCvRepo = {
    findOne: jest.fn(),
    update: jest.fn(),
    findOneByOrFail: jest.fn(),
  };
  const mockQueue = { add: jest.fn() };
  const mockUserService = { findByClerkId: jest.fn() };
  const mockBillingService = { canPerformAction: jest.fn() };
  const mockPrefillService = {};
  const mockPdfService = {};

  const EXISTING_CONTENT: CvContent = {
    version: 1,
    personalDetails: { fullName: 'Jane Doe', email: 'jane@example.com' },
    summary: 'Backend engineer.',
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

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CvService,
        { provide: getRepositoryToken(CvEntity), useValue: mockCvRepo },
        { provide: getQueueToken('cv-parsing'), useValue: mockQueue },
        { provide: ConfigService, useValue: makeConfig() },
        { provide: UserService, useValue: mockUserService },
        { provide: BillingService, useValue: mockBillingService },
        { provide: PrefillExtractionService, useValue: mockPrefillService },
        { provide: PdfGenerationService, useValue: mockPdfService },
        { provide: R2StorageService, useValue: { deleteObject: jest.fn() } },
        { provide: getDataSourceToken(), useValue: { transaction: jest.fn() } },
      ],
    }).compile();

    service = module.get<CvService>(CvService);
    mockUserService.findByClerkId.mockResolvedValue(MOCK_USER);
  });

  it('updates templateId without touching content — the write payload never includes `content`', async () => {
    mockCvRepo.findOne.mockResolvedValue({
      id: 'cv-1',
      userId: MOCK_USER.id,
      content: EXISTING_CONTENT,
      templateId: 'classic',
    });
    mockCvRepo.findOneByOrFail.mockResolvedValue({
      id: 'cv-1',
      content: EXISTING_CONTENT,
      templateId: 'classic',
    });

    await service.updateTemplate('clerk-1', 'cv-1', { templateId: 'classic' });

    expect(mockCvRepo.update).toHaveBeenCalledWith('cv-1', { templateId: 'classic' });
    const writePayload = mockCvRepo.update.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(writePayload).not.toHaveProperty('content');
  });

  it('round-trips: the CV returned after updateTemplate reflects the new templateId and unchanged content', async () => {
    mockCvRepo.findOne.mockResolvedValue({
      id: 'cv-1',
      userId: MOCK_USER.id,
      content: EXISTING_CONTENT,
      templateId: 'classic',
    });
    mockCvRepo.findOneByOrFail.mockResolvedValue({
      id: 'cv-1',
      content: EXISTING_CONTENT,
      templateId: 'classic',
    });

    const result = await service.updateTemplate('clerk-1', 'cv-1', { templateId: 'classic' });

    expect(result.templateId).toBe('classic');
    expect(result.content).toEqual(EXISTING_CONTENT);
  });

  it('rejects template selection on a CV with no builder content', async () => {
    mockCvRepo.findOne.mockResolvedValue({
      id: 'cv-1',
      userId: MOCK_USER.id,
      content: undefined,
    });

    await expect(
      service.updateTemplate('clerk-1', 'cv-1', { templateId: 'classic' }),
    ).rejects.toThrow(UnprocessableEntityException);
    expect(mockCvRepo.update).not.toHaveBeenCalled();
  });
});

// ─── Privacy/retention fix — deleteCv() ─────────────────────────────────────
// See the module report: individual CV deletion must genuinely scrub the
// R2 source file and the extracted personal-data columns, not just hide the
// row. The row itself is kept (soft-deleted) rather than hard-deleted,
// since analyses.cv_id/cover_letters.cv_id are NOT NULL with ON DELETE
// CASCADE — a hard delete would silently destroy unrelated history.
describe('CvService — deleteCv()', () => {
  let service: CvService;

  const mockCvRepo = {
    findOne: jest.fn(),
  };
  const mockQueue = { add: jest.fn() };
  const mockUserService = { findByClerkId: jest.fn() };
  const mockBillingService = { canPerformAction: jest.fn() };
  const mockPrefillService = {};
  const mockPdfService = {};
  const mockR2Storage = { deleteObject: jest.fn() };

  // DB scrub/soft-delete happens inside dataSource.transaction() (see the
  // module report's DB/R2 ordering fix) — mockManager stands in for the
  // transactional EntityManager, following the exact pattern already
  // established in user.service.spec.ts for UserService's own transaction.
  const mockManager = { softDelete: jest.fn(), update: jest.fn() };
  const mockDataSource = {
    transaction: jest.fn(async (cb: (manager: typeof mockManager) => Promise<unknown>) =>
      cb(mockManager),
    ),
  };

  const OWNED_CV = {
    id: 'cv-1',
    userId: MOCK_USER.id,
    content: { version: 1 },
    parsedContent: 'Some extracted resume text.',
    fileName: 'john-smith-resume.pdf',
    r2ObjectKey: `cvs/${MOCK_USER.id}/some-uuid-resume.pdf`,
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CvService,
        { provide: getRepositoryToken(CvEntity), useValue: mockCvRepo },
        { provide: getQueueToken('cv-parsing'), useValue: mockQueue },
        { provide: ConfigService, useValue: makeConfig() },
        { provide: UserService, useValue: mockUserService },
        { provide: BillingService, useValue: mockBillingService },
        { provide: PrefillExtractionService, useValue: mockPrefillService },
        { provide: PdfGenerationService, useValue: mockPdfService },
        { provide: R2StorageService, useValue: mockR2Storage },
        { provide: getDataSourceToken(), useValue: mockDataSource },
      ],
    }).compile();

    service = module.get<CvService>(CvService);
    mockUserService.findByClerkId.mockResolvedValue(MOCK_USER);
    mockR2Storage.deleteObject.mockResolvedValue(true);
    mockDataSource.transaction.mockImplementation(
      async (cb: (manager: typeof mockManager) => Promise<unknown>) => cb(mockManager),
    );
  });

  it('lets the owner delete their own CV', async () => {
    mockCvRepo.findOne.mockResolvedValue(OWNED_CV);

    await expect(service.deleteCv('clerk-1', 'cv-1')).resolves.toBeUndefined();

    expect(mockCvRepo.findOne).toHaveBeenCalledWith({
      where: { id: 'cv-1', userId: MOCK_USER.id },
    });
    expect(mockManager.softDelete).toHaveBeenCalledWith(CvEntity, 'cv-1');
  });

  it("another user cannot delete a CV they don't own — findOne is scoped to the caller's userId, so it returns nothing", async () => {
    // findOneForUser's query already includes userId in the WHERE clause —
    // a CV owned by someone else simply never matches.
    mockCvRepo.findOne.mockResolvedValue(null);

    await expect(service.deleteCv('clerk-1', 'not-mine')).rejects.toThrow(NotFoundException);

    expect(mockDataSource.transaction).not.toHaveBeenCalled();
    expect(mockR2Storage.deleteObject).not.toHaveBeenCalled();
  });

  // DB/R2 ordering fix (see the module report): R2 must be deleted BEFORE
  // any DB write — the reverse order left a window where a failed R2
  // delete could leave the file behind with no DB record of its key left
  // to retry cleanup with.
  it('deletes the R2 object BEFORE making any DB change', async () => {
    mockCvRepo.findOne.mockResolvedValue(OWNED_CV);
    const callOrder: string[] = [];
    mockR2Storage.deleteObject.mockImplementation(async () => {
      callOrder.push('r2');
      return true;
    });
    mockDataSource.transaction.mockImplementation(
      async (cb: (manager: typeof mockManager) => Promise<unknown>) => {
        callOrder.push('db');
        return cb(mockManager);
      },
    );

    await service.deleteCv('clerk-1', 'cv-1');

    expect(callOrder).toEqual(['r2', 'db']);
  });

  it('invokes R2 object deletion with exactly the CV’s stored key', async () => {
    mockCvRepo.findOne.mockResolvedValue(OWNED_CV);

    await service.deleteCv('clerk-1', 'cv-1');

    expect(mockR2Storage.deleteObject).toHaveBeenCalledTimes(1);
    expect(mockR2Storage.deleteObject).toHaveBeenCalledWith(OWNED_CV.r2ObjectKey);
  });

  it('genuinely clears parsed/structured CV data and file metadata rather than just hiding the row', async () => {
    mockCvRepo.findOne.mockResolvedValue(OWNED_CV);

    await service.deleteCv('clerk-1', 'cv-1');

    expect(mockManager.update).toHaveBeenCalledWith(CvEntity, 'cv-1', {
      content: null,
      parsedContent: null,
      fileName: null,
      r2ObjectKey: null,
    });
  });

  it('does not attempt an R2 delete when the CV has no stored object key (e.g. a builder-sourced CV) — proceeds directly to the DB scrub', async () => {
    mockCvRepo.findOne.mockResolvedValue({
      ...OWNED_CV,
      r2ObjectKey: undefined,
    });

    await expect(service.deleteCv('clerk-1', 'cv-1')).resolves.toBeUndefined();

    expect(mockR2Storage.deleteObject).not.toHaveBeenCalled();
    expect(mockManager.softDelete).toHaveBeenCalledWith(CvEntity, 'cv-1');
    expect(mockManager.update).toHaveBeenCalled();
  });

  it('a missing R2 object is treated as harmless/idempotent — deletion still succeeds', async () => {
    // R2StorageService.deleteObject() resolving `true` covers both "really
    // deleted" and "was already gone" — S3/R2's DeleteObject API itself is
    // idempotent and never distinguishes the two (see r2-storage.service.ts).
    mockCvRepo.findOne.mockResolvedValue(OWNED_CV);
    mockR2Storage.deleteObject.mockResolvedValue(true);

    await expect(service.deleteCv('clerk-1', 'cv-1')).resolves.toBeUndefined();
  });

  // Privacy-safety fix (see the module report): an unexpected R2 failure
  // must NOT be silently swallowed — the DB scrub must never run, and the
  // caller must see a clear failure rather than a false 204 success.
  it('an unexpected R2 deletion failure blocks the DB scrub entirely and surfaces a service error', async () => {
    mockCvRepo.findOne.mockResolvedValue(OWNED_CV);
    mockR2Storage.deleteObject.mockResolvedValue(false);

    await expect(service.deleteCv('clerk-1', 'cv-1')).rejects.toThrow(ServiceUnavailableException);

    expect(mockDataSource.transaction).not.toHaveBeenCalled();
    expect(mockManager.softDelete).not.toHaveBeenCalled();
    expect(mockManager.update).not.toHaveBeenCalled();
  });

  // Retry path (see the module report §3): if R2 succeeds but the DB
  // transaction then unexpectedly fails, the row is simply left unchanged.
  // A retry's R2 call is a harmless idempotent no-op (already deleted),
  // and the DB scrub can then complete — no compensation logic needed.
  it('remains safely retryable when R2 succeeds but the DB transaction unexpectedly fails', async () => {
    mockCvRepo.findOne.mockResolvedValue(OWNED_CV);
    mockDataSource.transaction.mockRejectedValueOnce(new Error('connection reset'));

    await expect(service.deleteCv('clerk-1', 'cv-1')).rejects.toThrow('connection reset');
    expect(mockR2Storage.deleteObject).toHaveBeenCalledTimes(1);

    // Retry: findOneForUser still finds the (unchanged) row, R2's own
    // idempotent delete succeeds again trivially, and this time the DB
    // transaction goes through (mockDataSource.transaction's default
    // beforeEach implementation, restored automatically after the
    // mockRejectedValueOnce above is consumed).
    await expect(service.deleteCv('clerk-1', 'cv-1')).resolves.toBeUndefined();
    expect(mockR2Storage.deleteObject).toHaveBeenCalledTimes(2);
    expect(mockManager.softDelete).toHaveBeenCalledWith(CvEntity, 'cv-1');
  });

  it('deleting the same CV twice is safe — the second call 404s instead of double-processing', async () => {
    // findOneForUser()'s query relies on TypeORM's default @DeleteDateColumn
    // filtering (deleted_at IS NULL) to naturally exclude an already
    // soft-deleted row — modelled here by the mock simply returning nothing
    // the second time, exactly as the real repository would.
    mockCvRepo.findOne.mockResolvedValueOnce(OWNED_CV).mockResolvedValueOnce(null);

    await service.deleteCv('clerk-1', 'cv-1');
    await expect(service.deleteCv('clerk-1', 'cv-1')).rejects.toThrow(NotFoundException);

    expect(mockManager.softDelete).toHaveBeenCalledTimes(1);
    expect(mockR2Storage.deleteObject).toHaveBeenCalledTimes(1);
  });
});
