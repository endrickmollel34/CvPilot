import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { getQueueToken } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { ForbiddenException } from '@nestjs/common';

import { CvService } from './cv.service';
import { CvEntity } from '../../entities/cv.entity';
import { UserService } from '../user/user.service';
import { BillingService } from '../billing/billing.service';
import { PrefillExtractionService } from './prefill-extraction.service';
import { PdfGenerationService } from './pdf-generation.service';

// S3Client is constructed unconditionally in CvService's constructor —
// mocked so tests never attempt a real R2 connection.
jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn().mockImplementation(() => ({ send: jest.fn() })),
  PutObjectCommand: jest.fn(),
  GetObjectCommand: jest.fn(),
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
