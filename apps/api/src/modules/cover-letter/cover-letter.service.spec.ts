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

  it('throws UnprocessableEntityException when CV parsing is not complete', async () => {
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

  // ─── getDownloadUrl() ────────────────────────────────────────────────────────

  it('throws NotFoundException when downloading a letter that does not belong to the user', async () => {
    mockRepo.findOne.mockResolvedValue(null);

    await expect(service.getDownloadUrl('clerk-1', 'letter-1')).rejects.toThrow(NotFoundException);
  });
});
