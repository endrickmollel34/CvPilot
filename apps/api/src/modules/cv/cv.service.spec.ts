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
import { MAX_FILE_SIZE_BYTES } from './dto/generate-upload-url.dto';
import { CvService } from './cv.service';
import { CvEntity } from '../../entities/cv.entity';
import { UserService } from '../user/user.service';
import { BillingService } from '../billing/billing.service';
import { PrefillExtractionService } from './prefill-extraction.service';
import { PdfGenerationService } from './pdf-generation.service';
import { R2StorageService } from '../../common/services/r2-storage.service';

// S3Client is constructed unconditionally in CvService's constructor —
// mocked so tests never attempt a real R2 connection. mockS3Send is a
// single shared jest.fn() (matching the pattern already established in
// cover-letter.service.spec.ts) so confirmUpload() tests can control/assert
// the HeadObjectCommand/CopyObjectCommand calls CvService makes through its
// one `this.s3` instance.
const mockS3Send = jest.fn();
jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest
    .fn()
    .mockImplementation(() => ({ send: (...args: unknown[]) => mockS3Send(...args) })),
  PutObjectCommand: jest.fn().mockImplementation((input: unknown) => ({ __cmd: 'Put', input })),
  GetObjectCommand: jest.fn().mockImplementation((input: unknown) => ({ __cmd: 'Get', input })),
  DeleteObjectCommand: jest
    .fn()
    .mockImplementation((input: unknown) => ({ __cmd: 'Delete', input })),
  HeadObjectCommand: jest.fn().mockImplementation((input: unknown) => ({ __cmd: 'Head', input })),
  CopyObjectCommand: jest.fn().mockImplementation((input: unknown) => ({ __cmd: 'Copy', input })),
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

// ─── Upload hardening — verified-size pending-upload flow ──────────────────
// See the upload-hardening audit report: dto.fileSizeBytes was previously
// trusted outright (a presigned PUT has no server-side size enforcement).
// confirmUpload() now HEADs the actual pending-cvs/ object in R2 and treats
// ONLY that ContentLength as authoritative, before promoting it to the
// permanent cvs/ prefix, writing the DB row, and enqueueing parsing.
describe('CvService — confirmUpload() verified-size pending upload flow', () => {
  let service: CvService;

  const mockCvRepo = { create: jest.fn(), save: jest.fn() };
  const mockQueue = { add: jest.fn() };
  const mockUserService = { findByClerkId: jest.fn() };
  const mockBillingService = { canPerformAction: jest.fn() };
  const mockPrefillService = {};
  const mockPdfService = {};
  const mockR2Storage = { deleteObject: jest.fn() };

  const PENDING_KEY = `pending-cvs/${MOCK_USER.id}/some-uuid-resume.pdf`;
  const PERMANENT_KEY = `cvs/${MOCK_USER.id}/some-uuid-resume.pdf`;

  const validDto = {
    r2ObjectKey: PENDING_KEY,
    fileName: 'resume.pdf',
    fileSizeBytes: 1024, // non-authoritative — see the HEAD-based tests below
    mimeType: 'application/pdf',
  };

  function headInput(command: unknown) {
    return command as { __cmd: string; input: { Bucket: string; Key: string } };
  }

  // Routes every this.s3.send() call by the tagged command type set up in
  // the module mock above — lets each test control HEAD/COPY behavior
  // independently without caring about call order.
  function mockS3Routes(opts: {
    headContentLength?: number | 'missing';
    headError?: Error;
    copyError?: Error;
  }) {
    mockS3Send.mockImplementation((command: unknown) => {
      const { __cmd } = headInput(command);
      if (__cmd === 'Head') {
        if (opts.headError) return Promise.reject(opts.headError);
        if (opts.headContentLength === 'missing') return Promise.resolve({});
        return Promise.resolve({ ContentLength: opts.headContentLength });
      }
      if (__cmd === 'Copy') {
        if (opts.copyError) return Promise.reject(opts.copyError);
        return Promise.resolve({});
      }
      return Promise.resolve({});
    });
  }

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
    mockR2Storage.deleteObject.mockResolvedValue(true);
    mockS3Routes({ headContentLength: 1024 * 1024 }); // 1 MB default — under the limit
  });

  // ── A: valid object under 5 MB ──
  it('A: promotes a valid under-5MB pending object — HEAD, copy, pending cleanup, verified DB values, parsing enqueued', async () => {
    mockS3Routes({ headContentLength: 1024 * 1024 });

    const result = await service.confirmUpload('clerk-1', validDto);

    // HEAD called against the pending key
    expect(mockS3Send).toHaveBeenCalledWith(
      expect.objectContaining({ __cmd: 'Head', input: { Bucket: 'bucket', Key: PENDING_KEY } }),
    );
    // Permanent copy occurs, with CopySource passed as the SDK's own
    // documented raw "bucket/key" form — NOT manually URL-encoded (see the
    // dedicated CopySource test below for why that matters).
    expect(mockS3Send).toHaveBeenCalledWith(
      expect.objectContaining({
        __cmd: 'Copy',
        input: {
          Bucket: 'bucket',
          CopySource: `bucket/${PENDING_KEY}`,
          Key: PERMANENT_KEY,
        },
      }),
    );
    // Pending object removed after successful promotion
    expect(mockR2Storage.deleteObject).toHaveBeenCalledWith(PENDING_KEY);
    // DB stores the permanent key and the actual HEAD-measured size, not
    // the client-declared dto.fileSizeBytes (1024)
    expect(mockCvRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ r2ObjectKey: PERMANENT_KEY, fileSizeBytes: 1024 * 1024 }),
    );
    expect(result).toEqual(
      expect.objectContaining({ r2ObjectKey: PERMANENT_KEY, fileSizeBytes: 1024 * 1024 }),
    );
    // Parsing enqueued only after everything above succeeded
    expect(mockQueue.add).toHaveBeenCalledWith('parse-cv', { cvId: 'cv-1' });
  });

  // CopySource correctness (see the pre-commit hardening report): the SDK
  // sends CopySource verbatim as the x-amz-copy-source header and does NOT
  // percent-encode it — confirmed by directly inspecting the installed
  // @aws-sdk/client-s3's outgoing request. A manually encodeURIComponent()-ed
  // value turns the required literal `/` separators into `%2F`, which R2/S3
  // never re-decodes, breaking the bucket/key split the API expects. This
  // app's own key charset (see safeFileName in generateUploadUrl()) already
  // strips everything outside [a-zA-Z0-9._-], so no character occurring in a
  // real pendingKey ever needs percent-encoding in the first place.
  it('passes CopySource in the raw "bucket/key" form, with literal `/` separators, not manually percent-encoded', async () => {
    mockS3Routes({ headContentLength: 1024 });

    await service.confirmUpload('clerk-1', validDto);

    const copyCall = mockS3Send.mock.calls.find(
      ([command]: [{ __cmd?: string }]) => command.__cmd === 'Copy',
    );
    const copySource = (copyCall?.[0] as { input: { CopySource: string } }).input.CopySource;

    expect(copySource).toBe(`bucket/${PENDING_KEY}`);
    expect(copySource).not.toContain('%2F');
    expect(copySource).not.toContain('%');
  });

  it('produces a correctly-formed CopySource even for an original filename containing spaces/unsafe characters, via the existing safeFileName sanitization — no manual encoding is needed or applied', async () => {
    // Mirrors generateUploadUrl()'s own sanitization: an original filename
    // like "My Resume (final)!.pdf" becomes a key containing only
    // [a-zA-Z0-9._-] before it's ever used as an R2 key — so the pending
    // key confirmUpload receives here already reflects that, exactly as a
    // real client would send it back.
    const sanitizedSuffix = 'My_Resume__final__.pdf'; // spaces/parens/! → "_"
    const pendingKeyWithSanitizedName = `pending-cvs/${MOCK_USER.id}/${sanitizedSuffix}`;
    const permanentKeyWithSanitizedName = `cvs/${MOCK_USER.id}/${sanitizedSuffix}`;
    mockS3Routes({ headContentLength: 1024 });

    await service.confirmUpload('clerk-1', {
      ...validDto,
      r2ObjectKey: pendingKeyWithSanitizedName,
    });

    const copyCall = mockS3Send.mock.calls.find(
      ([command]: [{ __cmd?: string }]) => command.__cmd === 'Copy',
    );
    const input = (copyCall?.[0] as { input: { CopySource: string; Key: string } }).input;

    expect(input.CopySource).toBe(`bucket/${pendingKeyWithSanitizedName}`);
    expect(input.Key).toBe(permanentKeyWithSanitizedName);
    expect(input.CopySource).not.toContain('%');
  });

  // ── B: exactly 5 MB ──
  it('B: accepts an object of exactly 5 MB (boundary)', async () => {
    mockS3Routes({ headContentLength: MAX_FILE_SIZE_BYTES });

    await expect(service.confirmUpload('clerk-1', validDto)).resolves.toEqual(
      expect.objectContaining({ fileSizeBytes: MAX_FILE_SIZE_BYTES }),
    );
    expect(mockR2Storage.deleteObject).not.toHaveBeenCalledWith(
      expect.stringContaining('oversized'),
    );
    expect(mockCvRepo.save).toHaveBeenCalled();
  });

  // ── C: over 5 MB ──
  it('C: rejects an object over 5 MB — deletes the pending object, no promotion, no DB save, no parsing', async () => {
    mockS3Routes({ headContentLength: MAX_FILE_SIZE_BYTES + 1 });

    await expect(service.confirmUpload('clerk-1', validDto)).rejects.toThrow(
      'CV files must be 5 MB or smaller.',
    );
    expect(mockR2Storage.deleteObject).toHaveBeenCalledWith(PENDING_KEY);
    expect(mockS3Send).not.toHaveBeenCalledWith(expect.objectContaining({ __cmd: 'Copy' }));
    expect(mockCvRepo.create).not.toHaveBeenCalled();
    expect(mockCvRepo.save).not.toHaveBeenCalled();
    expect(mockQueue.add).not.toHaveBeenCalled();
  });

  // ── D: client lies about size ──
  it('D: a lying dto.fileSizeBytes (1 byte) is ignored — rejected based on the real 50MB HEAD result', async () => {
    const lyingDto = { ...validDto, fileSizeBytes: 1 };
    mockS3Routes({ headContentLength: 50 * 1024 * 1024 });

    await expect(service.confirmUpload('clerk-1', lyingDto)).rejects.toThrow(
      'CV files must be 5 MB or smaller.',
    );
    expect(mockCvRepo.save).not.toHaveBeenCalled();
    expect(mockQueue.add).not.toHaveBeenCalled();
  });

  // ── E: missing object ──
  it('E: a missing pending object (HEAD NotFound) is rejected — no DB save, no parsing', async () => {
    const notFound = Object.assign(new Error('Not Found'), { name: 'NotFound' });
    mockS3Routes({ headError: notFound });

    await expect(service.confirmUpload('clerk-1', validDto)).rejects.toThrow(NotFoundException);
    expect(mockCvRepo.create).not.toHaveBeenCalled();
    expect(mockCvRepo.save).not.toHaveBeenCalled();
    expect(mockQueue.add).not.toHaveBeenCalled();
  });

  // ── F: R2 HEAD / network failure ──
  it('F: a generic R2 HEAD failure fails closed — no DB save, no parsing', async () => {
    const networkError = Object.assign(new Error('ECONNRESET'), { name: 'NetworkingError' });
    mockS3Routes({ headError: networkError });

    await expect(service.confirmUpload('clerk-1', validDto)).rejects.toThrow(
      ServiceUnavailableException,
    );
    expect(mockCvRepo.create).not.toHaveBeenCalled();
    expect(mockCvRepo.save).not.toHaveBeenCalled();
    expect(mockQueue.add).not.toHaveBeenCalled();
  });

  it('fails closed when HEAD succeeds but returns no usable ContentLength', async () => {
    mockS3Routes({ headContentLength: 'missing' });

    await expect(service.confirmUpload('clerk-1', validDto)).rejects.toThrow(
      ServiceUnavailableException,
    );
    expect(mockCvRepo.save).not.toHaveBeenCalled();
    expect(mockQueue.add).not.toHaveBeenCalled();
  });

  // ── G: copy failure ──
  it('G: a failed promote-copy fails closed — no DB save, no parsing; pending object is left for lifecycle cleanup', async () => {
    const copyError = Object.assign(new Error('copy failed'), { name: 'InternalError' });
    mockS3Routes({ headContentLength: 1024, copyError });

    await expect(service.confirmUpload('clerk-1', validDto)).rejects.toThrow(
      ServiceUnavailableException,
    );
    expect(mockCvRepo.create).not.toHaveBeenCalled();
    expect(mockCvRepo.save).not.toHaveBeenCalled();
    expect(mockQueue.add).not.toHaveBeenCalled();
    // The pending object is NOT explicitly deleted on copy failure — it's
    // left for the pending-cvs/ lifecycle rule rather than risking deleting
    // the only copy of data that failed to promote.
    expect(mockR2Storage.deleteObject).not.toHaveBeenCalledWith(PENDING_KEY);
  });

  // ── H: wrong user's pending prefix ──
  it("H: rejects a pending key inside another user's namespace before any HEAD/promotion happens", async () => {
    const foreignKeyDto = {
      ...validDto,
      r2ObjectKey: 'pending-cvs/some-other-user-id/leaked-uuid-resume.pdf',
    };

    await expect(service.confirmUpload('clerk-1', foreignKeyDto)).rejects.toThrow(
      ForbiddenException,
    );
    expect(mockS3Send).not.toHaveBeenCalled();
    expect(mockCvRepo.create).not.toHaveBeenCalled();
    expect(mockCvRepo.save).not.toHaveBeenCalled();
    expect(mockQueue.add).not.toHaveBeenCalled();
  });

  it('rejects a malformed key with no pending-cvs/ prefix at all', async () => {
    const malformedDto = { ...validDto, r2ObjectKey: 'not-a-real-object-key' };

    await expect(service.confirmUpload('clerk-1', malformedDto)).rejects.toThrow(
      ForbiddenException,
    );
    expect(mockS3Send).not.toHaveBeenCalled();
    expect(mockCvRepo.create).not.toHaveBeenCalled();
  });

  it("rejects a key whose prefix merely starts with this user's id (no path separator) — prevents a UUID-prefix collision bypass", async () => {
    const collisionDto = {
      ...validDto,
      r2ObjectKey: `pending-cvs/${MOCK_USER.id}-extra-suffix/resume.pdf`,
    };

    await expect(service.confirmUpload('clerk-1', collisionDto)).rejects.toThrow(
      ForbiddenException,
    );
    expect(mockCvRepo.create).not.toHaveBeenCalled();
  });

  it('rejects a key already promoted to the permanent cvs/ prefix — confirm only ever accepts pending-cvs/ keys', async () => {
    const permanentKeyDto = { ...validDto, r2ObjectKey: PERMANENT_KEY };

    await expect(service.confirmUpload('clerk-1', permanentKeyDto)).rejects.toThrow(
      ForbiddenException,
    );
    expect(mockS3Send).not.toHaveBeenCalled();
  });

  it('does not leak whether a foreign key exists — throws a generic message', async () => {
    const foreignKeyDto = {
      ...validDto,
      r2ObjectKey: 'pending-cvs/some-other-user-id/leaked-uuid-resume.pdf',
    };

    await expect(service.confirmUpload('clerk-1', foreignKeyDto)).rejects.toMatchObject({
      message: expect.not.stringContaining('some-other-user-id') as unknown as string,
    });
  });

  // ── I: normal flow unchanged (DOCX variant) ──
  it('I: a normal DOCX upload under 5 MB completes exactly like the PDF case', async () => {
    const docxDto = {
      ...validDto,
      fileName: 'resume.docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    };
    mockS3Routes({ headContentLength: 2048 });

    const result = await service.confirmUpload('clerk-1', docxDto);

    expect(result).toEqual(
      expect.objectContaining({
        r2ObjectKey: PERMANENT_KEY,
        fileSizeBytes: 2048,
        mimeType: docxDto.mimeType,
      }),
    );
    expect(mockQueue.add).toHaveBeenCalledWith('parse-cv', { cvId: 'cv-1' });
  });

  it('cleans up the newly-promoted permanent object if the DB save fails after a successful copy', async () => {
    mockS3Routes({ headContentLength: 1024 });
    mockCvRepo.save.mockRejectedValueOnce(new Error('connection reset'));

    await expect(service.confirmUpload('clerk-1', validDto)).rejects.toThrow('connection reset');

    expect(mockR2Storage.deleteObject).toHaveBeenCalledWith(PERMANENT_KEY);
    expect(mockQueue.add).not.toHaveBeenCalled();
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
