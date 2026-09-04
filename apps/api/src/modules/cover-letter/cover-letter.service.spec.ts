import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { getQueueToken } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import {
  ForbiddenException,
  NotFoundException,
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
      ['TypeScript', 'React'],
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

  it('passes undefined skills for upload-only CVs with no structured content (must still work)', async () => {
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

    expect(mockAiService.generateCoverLetter).toHaveBeenCalledWith(
      MOCK_CV.parsedContent,
      'Lead backend development.',
      'Senior Engineer',
      'Acme Corp',
      'professional',
      undefined,
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
});
