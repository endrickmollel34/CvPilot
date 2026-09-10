import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { getQueueToken } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import {
  ForbiddenException,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';

import type { CoverLetterJobData } from './cover-letter.service';
import { CoverLetterService } from './cover-letter.service';
import { CoverLetterAiService } from './cover-letter-ai.service';
import { CoverLetterEntity } from '../../entities/cover-letter.entity';
import { UserService } from '../user/user.service';
import { CvService } from '../cv/cv.service';
import { BillingService } from '../billing/billing.service';
import { AnalysisService } from '../analysis/analysis.service';
import { R2StorageService } from '../../common/services/r2-storage.service';

// S3Client is constructed unconditionally in CoverLetterService's
// constructor for getDownloadUrl()'s PDF upload/presign — mocked so tests
// never attempt a real R2 connection. mockS3Send lets tests inspect exactly
// which key/bucket each PutObjectCommand was sent with.
const mockS3Send = jest.fn();
jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest
    .fn()
    .mockImplementation(() => ({ send: (...args: unknown[]) => mockS3Send(...args) })),
  PutObjectCommand: jest.fn().mockImplementation((input: unknown) => ({ input })),
  GetObjectCommand: jest.fn().mockImplementation((input: unknown) => ({ input })),
}));
jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: jest.fn().mockResolvedValue('https://r2.example.com/signed-download-url'),
}));
jest.mock('./cover-letter-pdf.util', () => ({
  generateCoverLetterPdf: jest.fn().mockResolvedValue(Buffer.from('%PDF-fake')),
}));

const MOCK_USER = { id: 'user-1', clerkId: 'clerk-1' };
const MOCK_CV = {
  id: 'cv-1',
  userId: 'user-1',
  parseStatus: 'done',
  parsedContent: 'Software engineer with 3 years experience in TypeScript.',
};
const MOCK_LETTER: Partial<CoverLetterEntity> = {
  id: 'letter-1',
  userId: 'user-1',
  cvId: 'cv-1',
  jobTitle: 'Senior Engineer',
  companyName: 'Acme Corp',
  content: '',
  status: 'queued',
  tone: 'professional',
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('CoverLetterService', () => {
  let service: CoverLetterService;

  const mockRepo = {
    create: jest.fn(),
    save: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    findOne: jest.fn(),
    findOneBy: jest.fn(),
    findOneByOrFail: jest.fn(),
    findAndCount: jest.fn(),
    softDelete: jest.fn(),
  };
  const mockQueue = { add: jest.fn() };
  const mockEventEmitter = { emit: jest.fn(), on: jest.fn() };
  const mockConfig = {
    getOrThrow: jest.fn((key: string) => {
      const vals: Record<string, string> = {
        CLOUDFLARE_R2_ENDPOINT: 'https://r2.example.com',
        CLOUDFLARE_R2_ACCESS_KEY_ID: 'key',
        CLOUDFLARE_R2_SECRET_ACCESS_KEY: 'secret',
        CLOUDFLARE_R2_BUCKET_NAME: 'bucket',
      };
      return vals[key] ?? '';
    }),
  };
  const mockUserService = { findByClerkId: jest.fn() };
  const mockCvService = { findById: jest.fn() };
  const mockBillingService = { canPerformAction: jest.fn() };
  const mockAnalysisService = { findOneForUser: jest.fn() };
  const mockAiService = { generateCoverLetter: jest.fn() };
  const mockR2Storage = { deleteObject: jest.fn() };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CoverLetterService,
        { provide: getRepositoryToken(CoverLetterEntity), useValue: mockRepo },
        { provide: getQueueToken('cover-letter'), useValue: mockQueue },
        { provide: EventEmitter2, useValue: mockEventEmitter },
        { provide: ConfigService, useValue: mockConfig },
        { provide: UserService, useValue: mockUserService },
        { provide: CvService, useValue: mockCvService },
        { provide: BillingService, useValue: mockBillingService },
        { provide: AnalysisService, useValue: mockAnalysisService },
        { provide: CoverLetterAiService, useValue: mockAiService },
        { provide: R2StorageService, useValue: mockR2Storage },
      ],
    }).compile();

    service = module.get<CoverLetterService>(CoverLetterService);

    jest.clearAllMocks();
    mockUserService.findByClerkId.mockResolvedValue(MOCK_USER);
    mockCvService.findById.mockResolvedValue(MOCK_CV);
    mockBillingService.canPerformAction.mockResolvedValue(true);
    mockRepo.create.mockReturnValue(MOCK_LETTER);
    mockRepo.save.mockResolvedValue(MOCK_LETTER);
    mockQueue.add.mockResolvedValue({ id: 'job-1' });
    mockR2Storage.deleteObject.mockResolvedValue(true);
    mockS3Send.mockResolvedValue(undefined);
  });

  // ─── submit() ────────────────────────────────────────────────────────────────

  it('throws ForbiddenException when CV does not belong to the requesting user', async () => {
    mockCvService.findById.mockResolvedValue({ ...MOCK_CV, userId: 'other-user' });

    await expect(
      service.submit('clerk-1', {
        cvId: 'cv-1',
        jobTitle: 'Engineer',
        companyName: 'Acme Corp',
        jobDescription: 'Build things.',
      }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('throws UnprocessableEntityException when CV parsing is not complete and has no structured content', async () => {
    mockCvService.findById.mockResolvedValue({
      ...MOCK_CV,
      parseStatus: 'pending',
      parsedContent: undefined,
    });

    await expect(
      service.submit('clerk-1', {
        cvId: 'cv-1',
        jobTitle: 'Engineer',
        companyName: 'Acme Corp',
        jobDescription: 'Build things.',
      }),
    ).rejects.toThrow(UnprocessableEntityException);
  });

  it('accepts a builder/prefilled CV with structured content even though parsedContent was never populated (regression)', async () => {
    mockCvService.findById.mockResolvedValue({
      ...MOCK_CV,
      source: 'prefill',
      parseStatus: 'done',
      parsedContent: undefined,
      content: {
        version: 1,
        personalDetails: { fullName: 'Jane Doe', email: 'jane@example.com' },
        summary: 'Experienced engineer.',
        workExperience: [],
        education: [],
        skills: [],
        languages: [],
        certifications: [],
        sectionOrder: [],
      },
    });

    await expect(
      service.submit('clerk-1', {
        cvId: 'cv-1',
        jobTitle: 'Engineer',
        companyName: 'Acme Corp',
        jobDescription: 'Build things.',
      }),
    ).resolves.toBeDefined();
  });

  it('throws UnprocessableEntityException for structured content that is present but empty (malformed/empty content must not bypass validation)', async () => {
    mockCvService.findById.mockResolvedValue({
      ...MOCK_CV,
      source: 'builder',
      parseStatus: 'done',
      parsedContent: undefined,
      content: {
        version: 1,
        personalDetails: { fullName: '', email: '' },
        workExperience: [],
        education: [],
        skills: [],
        languages: [],
        certifications: [],
        sectionOrder: [],
      },
    });

    await expect(
      service.submit('clerk-1', {
        cvId: 'cv-1',
        jobTitle: 'Engineer',
        companyName: 'Acme Corp',
        jobDescription: 'Build things.',
      }),
    ).rejects.toThrow(UnprocessableEntityException);
  });

  it('throws ForbiddenException when monthly cover letter limit is reached', async () => {
    mockBillingService.canPerformAction.mockResolvedValue(false);

    await expect(
      service.submit('clerk-1', {
        cvId: 'cv-1',
        jobTitle: 'Engineer',
        companyName: 'Acme Corp',
        jobDescription: 'Build things.',
      }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('creates entity with queued status and enqueues job when all checks pass', async () => {
    await service.submit('clerk-1', {
      cvId: 'cv-1',
      jobTitle: 'Senior Engineer',
      companyName: 'Acme Corp',
      jobDescription: 'Lead backend development.',
      tone: 'professional',
    });

    expect(mockRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'queued', userId: 'user-1', cvId: 'cv-1' }),
    );
    expect(mockRepo.save).toHaveBeenCalled();
    expect(mockQueue.add).toHaveBeenCalledWith(
      'generate-letter',
      expect.objectContaining({ coverLetterId: 'letter-1', jobTitle: 'Senior Engineer' }),
    );
  });

  // V2 — jobDescription/recipientName/recipientTitle/companyAddress must be
  // persisted at creation time (not just used transiently for the AI job),
  // so the workspace can redisplay/edit them later and Regenerate has
  // something to read back.
  it('persists jobDescription, recipientName, recipientTitle, companyAddress, and senderAddress on the created entity', async () => {
    await service.submit('clerk-1', {
      cvId: 'cv-1',
      jobTitle: 'Senior Engineer',
      companyName: 'Acme Corp',
      jobDescription: 'Lead backend development.',
      tone: 'professional',
      recipientName: 'Jane Smith',
      recipientTitle: 'Head of Engineering',
      companyAddress: '1 Infinite Loop\nCupertino, CA',
      senderAddress: '12 Baker Street\nLondon, NW1 6XE',
    });

    expect(mockRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        jobDescription: 'Lead backend development.',
        recipientName: 'Jane Smith',
        recipientTitle: 'Head of Engineering',
        companyAddress: '1 Infinite Loop\nCupertino, CA',
        senderAddress: '12 Baker Street\nLondon, NW1 6XE',
      }),
    );
  });

  it('persists undefined recipient/address fields when none are provided (they stay optional)', async () => {
    await service.submit('clerk-1', {
      cvId: 'cv-1',
      jobTitle: 'Senior Engineer',
      companyName: 'Acme Corp',
      jobDescription: 'Lead backend development.',
    });

    const createArg = mockRepo.create.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(createArg['recipientName']).toBeUndefined();
    expect(createArg['recipientTitle']).toBeUndefined();
    expect(createArg['companyAddress']).toBeUndefined();
    expect(createArg['senderAddress']).toBeUndefined();
  });

  // ─── process() ───────────────────────────────────────────────────────────────

  it('updates entity to generated and emits SSE event when AI succeeds', async () => {
    const generatedContent =
      'Dear Hiring Manager, I am writing to express my interest in the Senior Engineer position at Acme Corp. ' +
      'My experience in TypeScript development makes me an excellent candidate for this role. ' +
      'I look forward to discussing how I can contribute to Acme Corp.';

    mockAiService.generateCoverLetter.mockResolvedValue({
      content: generatedContent,
      modelUsed: 'gpt-4o',
      tokensUsed: 500,
    });
    mockCvService.findById.mockResolvedValue(MOCK_CV);

    await service.process({
      data: {
        coverLetterId: 'letter-1',
        userId: 'user-1',
        cvId: 'cv-1',
        jobTitle: 'Senior Engineer',
        companyName: 'Acme Corp',
        jobDescription: 'Lead backend development.',
        tone: 'professional',
      },
    } as unknown as Job<CoverLetterJobData>);

    expect(mockRepo.update).toHaveBeenCalledWith(
      'letter-1',
      expect.objectContaining({ status: 'generated', content: generatedContent }),
    );
    expect(mockEventEmitter.emit).toHaveBeenCalledWith('cover-letter.completed', {
      coverLetterId: 'letter-1',
    });
  });

  it('generates from a builder/prefilled CV whose usable content lives only in structured content, never in parsedContent (regression)', async () => {
    mockAiService.generateCoverLetter.mockResolvedValue({
      content: 'Dear Hiring Manager, ... Acme Corp ... Senior Engineer ...',
      modelUsed: 'gpt-4o',
      tokensUsed: 300,
    });
    // Matches the real shape CvService produces for source 'builder' /
    // 'prefill' / 'tailored': parsedContent is never populated for these —
    // only content is. See cv-text-resolver.util.ts.
    mockCvService.findById.mockResolvedValue({
      ...MOCK_CV,
      parsedContent: undefined,
      content: {
        version: 1,
        personalDetails: { fullName: 'Jane Doe', email: 'jane@example.com' },
        workExperience: [],
        education: [],
        skills: [
          { id: 'sk-1', name: 'TypeScript' },
          { id: 'sk-2', name: 'React' },
        ],
        languages: [],
        certifications: [],
        sectionOrder: [],
      },
    });

    await service.process({
      data: {
        coverLetterId: 'letter-1',
        userId: 'user-1',
        cvId: 'cv-1',
        jobTitle: 'Senior Engineer',
        companyName: 'Acme Corp',
        jobDescription: 'Lead backend development.',
        tone: 'professional',
      },
    } as unknown as Job<CoverLetterJobData>);

    const [cvTextArg] = mockAiService.generateCoverLetter.mock.calls[0] as [string];
    expect(cvTextArg).toContain('Jane Doe');
    expect(cvTextArg).toContain('TypeScript');
    expect(mockAiService.generateCoverLetter).toHaveBeenCalledWith(
      cvTextArg,
      'Lead backend development.',
      'Senior Engineer',
      'Acme Corp',
      'professional',
      { experienceText: '', skillsOnlyTerms: ['TypeScript', 'React'] },
    );
    expect(mockRepo.update).toHaveBeenCalledWith(
      'letter-1',
      expect.objectContaining({ status: 'generated' }),
    );
  });

  it('prefers current structured content over a stale original extraction when both happen to be present', async () => {
    mockAiService.generateCoverLetter.mockResolvedValue({
      content: 'Dear Hiring Manager, ... Acme Corp ... Senior Engineer ...',
      modelUsed: 'gpt-4o',
      tokensUsed: 300,
    });
    mockCvService.findById.mockResolvedValue({
      ...MOCK_CV, // parsedContent: 'Software engineer with 3 years experience in TypeScript.'
      content: {
        version: 1,
        personalDetails: { fullName: 'Jane Doe', email: 'jane@example.com' },
        workExperience: [],
        education: [],
        skills: [],
        languages: [],
        certifications: [],
        sectionOrder: [],
      },
    });

    await service.process({
      data: {
        coverLetterId: 'letter-1',
        userId: 'user-1',
        cvId: 'cv-1',
        jobTitle: 'Senior Engineer',
        companyName: 'Acme Corp',
        jobDescription: 'Lead backend development.',
        tone: 'professional',
      },
    } as unknown as Job<CoverLetterJobData>);

    const [cvTextArg] = mockAiService.generateCoverLetter.mock.calls[0] as [string];
    expect(cvTextArg).toContain('Jane Doe');
    expect(cvTextArg).not.toBe(MOCK_CV.parsedContent);
  });

  it('updates entity to failed without calling the AI service when the CV genuinely has no usable content', async () => {
    mockCvService.findById.mockResolvedValue({
      ...MOCK_CV,
      parseStatus: 'pending',
      parsedContent: undefined,
    });

    await expect(
      service.process({
        data: {
          coverLetterId: 'letter-1',
          userId: 'user-1',
          cvId: 'cv-1',
          jobTitle: 'Senior Engineer',
          companyName: 'Acme Corp',
          jobDescription: 'Lead backend development.',
          tone: 'professional',
        },
      } as unknown as Job<CoverLetterJobData>),
    ).resolves.toBeUndefined();

    expect(mockAiService.generateCoverLetter).not.toHaveBeenCalled();
    expect(mockRepo.update).toHaveBeenCalledWith('letter-1', { status: 'failed' });
  });

  it('passes plain-text evidence with no skills-only terms for upload-only CVs with no structured content (must still work)', async () => {
    mockAiService.generateCoverLetter.mockResolvedValue({
      content: 'Dear Hiring Manager, ... Acme Corp ... Senior Engineer ...',
      modelUsed: 'gpt-4o',
      tokensUsed: 300,
    });
    mockCvService.findById.mockResolvedValue(MOCK_CV); // no `content` field

    await service.process({
      data: {
        coverLetterId: 'letter-1',
        userId: 'user-1',
        cvId: 'cv-1',
        jobTitle: 'Senior Engineer',
        companyName: 'Acme Corp',
        jobDescription: 'Lead backend development.',
        tone: 'professional',
      },
    } as unknown as Job<CoverLetterJobData>);

    // MOCK_CV.parsedContent has no recognisable section header, so the
    // plain-text evidence builder falls back to treating it all as
    // experience evidence (see cv-evidence.util.ts).
    expect(mockAiService.generateCoverLetter).toHaveBeenCalledWith(
      MOCK_CV.parsedContent,
      'Lead backend development.',
      'Senior Engineer',
      'Acme Corp',
      'professional',
      { experienceText: MOCK_CV.parsedContent, skillsOnlyTerms: [] },
    );
  });

  it('updates entity to failed and does not re-throw when AI fails', async () => {
    mockAiService.generateCoverLetter.mockRejectedValue(new Error('All AI providers exhausted'));
    mockCvService.findById.mockResolvedValue(MOCK_CV);

    await expect(
      service.process({
        data: {
          coverLetterId: 'letter-1',
          userId: 'user-1',
          cvId: 'cv-1',
          jobTitle: 'Senior Engineer',
          companyName: 'Acme Corp',
          jobDescription: 'Lead backend development.',
          tone: 'professional',
        },
      } as unknown as Job<CoverLetterJobData>),
    ).resolves.toBeUndefined(); // no re-throw

    expect(mockRepo.update).toHaveBeenCalledWith('letter-1', { status: 'failed' });
  });

  // Diagnostic-loss fix: process()'s catch must log the real underlying
  // reason (here, CoverLetterAiService's own diagnostic message, already
  // stripped of secrets/CV content by describeError()) in the primary log
  // string itself, plus a proper stack via Logger.error()'s dedicated
  // `trace` argument — not the raw Error object passed the way `.warn()`
  // would treat it as an opaque "context" label.
  it('logs the real underlying failure reason and a stack trace when AI generation fails', async () => {
    const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const realError = new Error(
      'Cover letter generation failed after retries: Error: Rate limit reached for gpt-4o',
    );
    mockAiService.generateCoverLetter.mockRejectedValue(realError);
    mockCvService.findById.mockResolvedValue(MOCK_CV);

    await service.process({
      data: {
        coverLetterId: 'letter-1',
        userId: 'user-1',
        cvId: 'cv-1',
        jobTitle: 'Senior Engineer',
        companyName: 'Acme Corp',
        jobDescription: 'Lead backend development.',
        tone: 'professional',
      },
    } as unknown as Job<CoverLetterJobData>);

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Rate limit reached for gpt-4o'),
      realError.stack,
    );

    errorSpy.mockRestore();
  });

  // ─── update() ────────────────────────────────────────────────────────────────

  it('throws NotFoundException when updating a letter that does not belong to the user', async () => {
    mockRepo.findOne.mockResolvedValue(null);

    await expect(
      service.update('clerk-1', 'letter-1', {
        content: 'New content for Acme Corp Senior Engineer role.',
      }),
    ).rejects.toThrow(NotFoundException);
  });

  it('saves updated content when ownership check passes', async () => {
    mockRepo.findOne.mockResolvedValue(MOCK_LETTER);
    mockRepo.findOneByOrFail.mockResolvedValue({
      ...MOCK_LETTER,
      content: 'Updated content mentioning Acme Corp and Senior Engineer.',
    });

    const result = await service.update('clerk-1', 'letter-1', {
      content: 'Updated content mentioning Acme Corp and Senior Engineer.',
    });

    expect(mockRepo.update).toHaveBeenCalledWith('letter-1', {
      content: 'Updated content mentioning Acme Corp and Senior Engineer.',
    });
    expect(result.content).toBe('Updated content mentioning Acme Corp and Senior Engineer.');
  });

  // V2 — update() must accept a genuine partial payload: only structured
  // fields, only content, or a mix — and never clobber a field the caller
  // didn't send (see the dynamic-patch doc comment on update() itself).
  it('saves only the structured fields provided, leaving content untouched (partial update)', async () => {
    mockRepo.findOne.mockResolvedValue(MOCK_LETTER);
    mockRepo.findOneByOrFail.mockResolvedValue(MOCK_LETTER);

    await service.update('clerk-1', 'letter-1', {
      jobTitle: 'Staff Engineer',
      recipientName: 'Jane Smith',
    });

    expect(mockRepo.update).toHaveBeenCalledWith('letter-1', {
      jobTitle: 'Staff Engineer',
      recipientName: 'Jane Smith',
    });
  });

  it('saves jobDescription, recipientTitle, and companyAddress via update()', async () => {
    mockRepo.findOne.mockResolvedValue(MOCK_LETTER);
    mockRepo.findOneByOrFail.mockResolvedValue(MOCK_LETTER);

    await service.update('clerk-1', 'letter-1', {
      jobDescription: 'Updated job description text.',
      recipientTitle: 'Head of Talent',
      companyAddress: '221B Baker Street\nLondon',
    });

    expect(mockRepo.update).toHaveBeenCalledWith('letter-1', {
      jobDescription: 'Updated job description text.',
      recipientTitle: 'Head of Talent',
      companyAddress: '221B Baker Street\nLondon',
    });
  });

  // V2.1 — senderAddress persistence, including the explicit-null "clear"
  // case, which is the whole reason this one field is typed `| null`
  // instead of matching its optional-string siblings above.
  it('saves a senderAddress via update()', async () => {
    mockRepo.findOne.mockResolvedValue(MOCK_LETTER);
    mockRepo.findOneByOrFail.mockResolvedValue(MOCK_LETTER);

    await service.update('clerk-1', 'letter-1', {
      senderAddress: '12 Baker Street\nLondon, NW1 6XE',
    });

    expect(mockRepo.update).toHaveBeenCalledWith('letter-1', {
      senderAddress: '12 Baker Street\nLondon, NW1 6XE',
    });
  });

  it('clears a previously-set senderAddress when explicitly sent as null', async () => {
    mockRepo.findOne.mockResolvedValue({ ...MOCK_LETTER, senderAddress: '12 Baker Street' });
    mockRepo.findOneByOrFail.mockResolvedValue({ ...MOCK_LETTER, senderAddress: null });

    await service.update('clerk-1', 'letter-1', { senderAddress: null });

    expect(mockRepo.update).toHaveBeenCalledWith('letter-1', { senderAddress: null });
  });

  it('leaves senderAddress untouched when omitted from the update payload', async () => {
    mockRepo.findOne.mockResolvedValue(MOCK_LETTER);
    mockRepo.findOneByOrFail.mockResolvedValue(MOCK_LETTER);

    await service.update('clerk-1', 'letter-1', { jobTitle: 'Staff Engineer' });

    const updateArg = mockRepo.update.mock.calls[0]?.[1] as Record<string, unknown>;
    expect('senderAddress' in updateArg).toBe(true);
    expect(updateArg['senderAddress']).toBeUndefined();
  });

  // ─── regenerate() ────────────────────────────────────────────────────────────

  it('regenerate() throws UnprocessableEntityException when the letter has no persisted jobDescription', async () => {
    mockRepo.findOne.mockResolvedValue({ ...MOCK_LETTER, jobDescription: undefined });

    await expect(service.regenerate('clerk-1', 'letter-1')).rejects.toThrow(
      UnprocessableEntityException,
    );
    expect(mockQueue.add).not.toHaveBeenCalled();
  });

  it('regenerate() throws ForbiddenException when the monthly quota is exhausted', async () => {
    mockRepo.findOne.mockResolvedValue({ ...MOCK_LETTER, jobDescription: 'Lead backend dev.' });
    mockBillingService.canPerformAction.mockResolvedValue(false);

    await expect(service.regenerate('clerk-1', 'letter-1')).rejects.toThrow(ForbiddenException);
    expect(mockQueue.add).not.toHaveBeenCalled();
  });

  it('regenerate() sets status to processing and re-enqueues the same generate-letter job using persisted fields', async () => {
    const letterWithJobDescription = {
      ...MOCK_LETTER,
      jobDescription: 'Lead backend development.',
      recipientName: 'Jane Smith',
    };
    mockRepo.findOne.mockResolvedValue(letterWithJobDescription);
    mockRepo.findOneByOrFail.mockResolvedValue({
      ...letterWithJobDescription,
      status: 'processing',
    });

    const result = await service.regenerate('clerk-1', 'letter-1');

    expect(mockRepo.update).toHaveBeenCalledWith('letter-1', { status: 'processing' });
    expect(mockQueue.add).toHaveBeenCalledWith('generate-letter', {
      coverLetterId: 'letter-1',
      userId: 'user-1',
      cvId: 'cv-1',
      analysisId: undefined,
      jobTitle: 'Senior Engineer',
      companyName: 'Acme Corp',
      jobDescription: 'Lead backend development.',
      tone: 'professional',
    });
    expect(result.status).toBe('processing');
  });

  // ─── listForUser() ───────────────────────────────────────────────────────────

  it('returns only cover letters belonging to the requesting user', async () => {
    const userLetters = [MOCK_LETTER, { ...MOCK_LETTER, id: 'letter-2' }];
    mockRepo.findAndCount.mockResolvedValue([userLetters, 2]);

    const result = await service.listForUser('clerk-1', { page: 1, limit: 20 });

    expect(mockRepo.findAndCount).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'user-1' } }),
    );
    expect(result.total).toBe(2);
    expect(result.items).toHaveLength(2);
  });

  it('requests the cv relation so history rows can show the source CV title (History Phase 1)', async () => {
    mockRepo.findAndCount.mockResolvedValue([[], 0]);

    await service.listForUser('clerk-1', { page: 1, limit: 20 });

    expect(mockRepo.findAndCount).toHaveBeenCalledWith(
      expect.objectContaining({ relations: ['cv'] }),
    );
  });

  // ─── findOneForUser() ────────────────────────────────────────────────────────

  it('requests the cv relation when loading a single cover letter (History Phase 1)', async () => {
    mockRepo.findOne.mockResolvedValue(MOCK_LETTER);

    await service.findOneForUser('clerk-1', 'letter-1');

    expect(mockRepo.findOne).toHaveBeenCalledWith({
      where: { id: 'letter-1', userId: 'user-1' },
      relations: ['cv'],
    });
  });

  it('tolerates a missing cv relation (source CV since deleted) without throwing', async () => {
    mockRepo.findOne.mockResolvedValue({ ...MOCK_LETTER, cv: undefined });

    const result = await service.findOneForUser('clerk-1', 'letter-1');

    expect(result.cv).toBeUndefined();
  });

  // ─── getDownloadUrl() ────────────────────────────────────────────────────────

  it('throws NotFoundException when downloading a letter that does not belong to the user', async () => {
    mockRepo.findOne.mockResolvedValue(null);

    await expect(service.getDownloadUrl('clerk-1', 'letter-1')).rejects.toThrow(NotFoundException);
  });

  const DOWNLOADABLE_LETTER = {
    ...MOCK_LETTER,
    status: 'generated' as const,
    content: 'Dear Hiring Manager, ...',
  };

  // Orphan-PDF fix (see the module report): every download must reuse the
  // SAME deterministic R2 key (derived from the letter's own id), never a
  // fresh randomUUID() per call — otherwise every re-download abandons the
  // previous object, accumulating unlimited orphans.
  it('uploads the PDF under a deterministic key derived from the letter id, not a fresh random one', async () => {
    mockRepo.findOne.mockResolvedValue(DOWNLOADABLE_LETTER);

    await service.getDownloadUrl('clerk-1', 'letter-1');

    expect(mockS3Send).toHaveBeenCalledTimes(1);
    const putCall = mockS3Send.mock.calls[0]?.[0] as { input: { Bucket: string; Key: string } };
    expect(putCall.input.Key).toBe(`cover-letters/${MOCK_LETTER.userId}/letter-1.pdf`);
    expect(mockRepo.update).toHaveBeenCalledWith('letter-1', {
      r2ObjectKey: `cover-letters/${MOCK_LETTER.userId}/letter-1.pdf`,
      status: 'downloaded',
    });
  });

  it('repeated downloads overwrite the same key instead of creating a new object each time', async () => {
    mockRepo.findOne.mockResolvedValue(DOWNLOADABLE_LETTER);

    await service.getDownloadUrl('clerk-1', 'letter-1');
    await service.getDownloadUrl('clerk-1', 'letter-1');

    expect(mockS3Send).toHaveBeenCalledTimes(2);
    const firstKey = (mockS3Send.mock.calls[0]?.[0] as { input: { Key: string } }).input.Key;
    const secondKey = (mockS3Send.mock.calls[1]?.[0] as { input: { Key: string } }).input.Key;
    expect(firstKey).toBe(secondKey);
  });

  it('still returns a short-lived signed download URL', async () => {
    mockRepo.findOne.mockResolvedValue(DOWNLOADABLE_LETTER);

    const result = await service.getDownloadUrl('clerk-1', 'letter-1');

    expect(result).toEqual({
      downloadUrl: 'https://r2.example.com/signed-download-url',
      format: 'pdf',
    });
  });

  it('ownership is still checked before any R2 access — ownership check is unaffected by the key change', async () => {
    mockRepo.findOne.mockResolvedValue(null);

    await expect(service.getDownloadUrl('clerk-1', 'letter-1')).rejects.toThrow(NotFoundException);
    expect(mockS3Send).not.toHaveBeenCalled();
  });

  // ─── deleteCoverLetter() ─────────────────────────────────────────────────────
  // Privacy/retention fix (see the module report): unlike a CV, nothing
  // else in the schema references cover_letters.id, so deletion here is a
  // genuine hard delete plus R2 cleanup of the stored PDF, not a soft-hide.
  describe('deleteCoverLetter()', () => {
    it('lets the owner delete their own cover letter', async () => {
      mockRepo.findOne.mockResolvedValue({ ...MOCK_LETTER, r2ObjectKey: undefined });

      await expect(service.deleteCoverLetter('clerk-1', 'letter-1')).resolves.toBeUndefined();

      expect(mockRepo.findOne).toHaveBeenCalledWith({
        where: { id: 'letter-1', userId: MOCK_USER.id },
        relations: ['cv'],
      });
      expect(mockRepo.delete).toHaveBeenCalledWith('letter-1');
    });

    it("another user cannot delete a letter they don't own", async () => {
      // findOneForUser()'s query is already scoped to the caller's userId —
      // a letter owned by someone else simply never matches.
      mockRepo.findOne.mockResolvedValue(null);

      await expect(service.deleteCoverLetter('clerk-1', 'not-mine')).rejects.toThrow(
        NotFoundException,
      );
      expect(mockRepo.delete).not.toHaveBeenCalled();
      expect(mockR2Storage.deleteObject).not.toHaveBeenCalled();
    });

    it('removes the stored PDF object when one exists', async () => {
      const key = `cover-letters/${MOCK_USER.id}/letter-1.pdf`;
      mockRepo.findOne.mockResolvedValue({ ...MOCK_LETTER, r2ObjectKey: key });

      await service.deleteCoverLetter('clerk-1', 'letter-1');

      expect(mockR2Storage.deleteObject).toHaveBeenCalledTimes(1);
      expect(mockR2Storage.deleteObject).toHaveBeenCalledWith(key);
    });

    it('does not attempt an R2 delete when the letter was never downloaded (no stored key)', async () => {
      mockRepo.findOne.mockResolvedValue({ ...MOCK_LETTER, r2ObjectKey: undefined });

      await service.deleteCoverLetter('clerk-1', 'letter-1');

      expect(mockR2Storage.deleteObject).not.toHaveBeenCalled();
    });

    it('genuinely deletes the DB row rather than soft-hiding it', async () => {
      mockRepo.findOne.mockResolvedValue({ ...MOCK_LETTER, r2ObjectKey: undefined });

      await service.deleteCoverLetter('clerk-1', 'letter-1');

      expect(mockRepo.delete).toHaveBeenCalledWith('letter-1');
      expect(mockRepo.softDelete).not.toHaveBeenCalled();
    });

    it('does not affect an unrelated letter belonging to the same user', async () => {
      mockRepo.findOne.mockResolvedValue({
        ...MOCK_LETTER,
        id: 'letter-1',
        r2ObjectKey: undefined,
      });

      await service.deleteCoverLetter('clerk-1', 'letter-1');

      expect(mockRepo.delete).toHaveBeenCalledTimes(1);
      expect(mockRepo.delete).toHaveBeenCalledWith('letter-1');
      expect(mockRepo.delete).not.toHaveBeenCalledWith('letter-2');
    });

    // DB/R2 ordering fix (see the module report): R2 must be deleted BEFORE
    // the row is hard-deleted — the reverse order left a window where a
    // failed R2 delete could leave the PDF behind in R2 while the one row
    // that recorded its key was already permanently gone.
    it('deletes the R2 object BEFORE hard-deleting the row', async () => {
      const key = `cover-letters/${MOCK_USER.id}/letter-1.pdf`;
      mockRepo.findOne.mockResolvedValue({ ...MOCK_LETTER, r2ObjectKey: key });
      const callOrder: string[] = [];
      mockR2Storage.deleteObject.mockImplementation(async () => {
        callOrder.push('r2');
        return true;
      });
      mockRepo.delete.mockImplementation(async () => {
        callOrder.push('db');
      });

      await service.deleteCoverLetter('clerk-1', 'letter-1');

      expect(callOrder).toEqual(['r2', 'db']);
    });

    // Privacy-safety fix (see the module report): an unexpected R2 failure
    // must NOT be silently swallowed — the row must be left fully intact
    // (not hard-deleted), and the caller must see a clear failure rather
    // than a false 204 success.
    it('an unexpected R2 deletion failure blocks the hard delete entirely and surfaces a service error', async () => {
      const key = `cover-letters/${MOCK_USER.id}/letter-1.pdf`;
      mockRepo.findOne.mockResolvedValue({ ...MOCK_LETTER, r2ObjectKey: key });
      mockR2Storage.deleteObject.mockResolvedValue(false);

      await expect(service.deleteCoverLetter('clerk-1', 'letter-1')).rejects.toThrow(
        ServiceUnavailableException,
      );
      expect(mockRepo.delete).not.toHaveBeenCalled();
    });

    // Retry path (see the module report §3): if R2 succeeds but the DB
    // delete then unexpectedly fails, the row is simply left unchanged. A
    // retry's R2 call is a harmless idempotent no-op (already deleted),
    // and the hard delete can then complete — no compensation logic needed.
    it('remains safely retryable when R2 succeeds but the DB delete unexpectedly fails', async () => {
      const key = `cover-letters/${MOCK_USER.id}/letter-1.pdf`;
      mockRepo.findOne.mockResolvedValue({ ...MOCK_LETTER, r2ObjectKey: key });
      mockRepo.delete.mockRejectedValueOnce(new Error('connection reset'));

      await expect(service.deleteCoverLetter('clerk-1', 'letter-1')).rejects.toThrow(
        'connection reset',
      );
      expect(mockR2Storage.deleteObject).toHaveBeenCalledTimes(1);

      // Retry: findOneForUser still finds the (unchanged) row, R2's own
      // idempotent delete succeeds again trivially, and this time the DB
      // delete goes through (mockRepo.delete's default resolved-value
      // behavior, restored automatically after mockRejectedValueOnce above
      // is consumed).
      await expect(service.deleteCoverLetter('clerk-1', 'letter-1')).resolves.toBeUndefined();
      expect(mockR2Storage.deleteObject).toHaveBeenCalledTimes(2);
      expect(mockRepo.delete).toHaveBeenCalledWith('letter-1');
    });
  });
});
