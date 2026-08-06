import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { getQueueToken } from '@nestjs/bullmq';
import {
  ForbiddenException,
  NotFoundException,
  UnprocessableEntityException,
  ConflictException,
} from '@nestjs/common';

import { TailoringService } from './tailoring.service';
import { TailoringAiService } from './tailoring-ai.service';
import { TailoringEntity } from '../../entities/tailoring.entity';
import { UserService } from '../user/user.service';
import { BillingService } from '../billing/billing.service';
import { CvService } from '../cv/cv.service';
import type { CvContent, TailoringSuggestion } from '@cvpilot/shared';

const MOCK_USER = { id: 'user-1', clerkId: 'clerk-1', plan: 'pro' };

const MOCK_CONTENT: CvContent = {
  version: 1,
  personalDetails: { fullName: 'Jane Doe', email: 'jane@example.com' },
  summary: 'Experienced engineer.',
  workExperience: [
    {
      id: 'we-1',
      company: 'Acme',
      title: 'Engineer',
      startDate: '2022-01',
      current: true,
      bullets: ['Built REST APIs', 'Managed deployments'],
    },
  ],
  education: [],
  skills: [{ id: 'sk-1', name: 'TypeScript' }],
  languages: [],
  certifications: [],
  sectionOrder: ['summary', 'workExperience', 'education', 'skills', 'languages', 'certifications'],
};

const MOCK_CV = { id: 'cv-1', userId: 'user-1', content: MOCK_CONTENT };

const MOCK_SUGGESTIONS: TailoringSuggestion[] = [
  {
    id: 's1',
    section: 'summary',
    originalContent: 'Experienced engineer.',
    suggestedContent: 'Results-driven engineer with 3+ years in backend development.',
    reason: 'More specific and keyword-rich for this role.',
    priority: 'HIGH',
  },
  {
    id: 's2',
    section: 'workExperience',
    field: 'Acme | Engineer',
    originalContent: 'Built REST APIs',
    suggestedContent: 'Designed and built RESTful APIs serving 50k requests/day',
    reason: 'Adds quantifiable impact which the JD emphasises.',
    priority: 'HIGH',
  },
  {
    id: 's3',
    section: 'skills',
    originalContent: '',
    suggestedContent: 'Docker',
    reason: 'Docker is listed as a required skill.',
    priority: 'MEDIUM',
  },
];

const MOCK_TAILORING: Partial<TailoringEntity> = {
  id: 'tailor-1',
  userId: 'user-1',
  masterCvId: 'cv-1',
  jobTitle: 'Backend Engineer',
  companyName: 'TechCorp',
  jobDescription: 'We are looking for an experienced backend engineer who knows Docker and APIs.',
  status: 'pending',
};

const MOCK_DONE_TAILORING: Partial<TailoringEntity> = {
  ...MOCK_TAILORING,
  status: 'done',
  suggestions: MOCK_SUGGESTIONS,
  tailoredCvId: undefined,
};

// ─── TailoringService tests ───────────────────────────────────────────────────

describe('TailoringService', () => {
  let service: TailoringService;

  const mockRepo = {
    create: jest.fn(),
    save: jest.fn(),
    update: jest.fn(),
    findOne: jest.fn(),
    findOneBy: jest.fn(),
    findOneByOrFail: jest.fn(),
    find: jest.fn(),
    count: jest.fn(),
  };
  const mockQueue = { add: jest.fn() };
  const mockUserService = { findByClerkId: jest.fn() };
  const mockBillingService = { getUserPlan: jest.fn() };
  const mockCvService = {
    findById: jest.fn(),
    findOneForUser: jest.fn(),
    createTailored: jest.fn(),
  };
  const mockTailoringAiService = { runTailoring: jest.fn() };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TailoringService,
        { provide: getRepositoryToken(TailoringEntity), useValue: mockRepo },
        { provide: getQueueToken('cv-tailoring'), useValue: mockQueue },
        { provide: UserService, useValue: mockUserService },
        { provide: BillingService, useValue: mockBillingService },
        { provide: CvService, useValue: mockCvService },
        { provide: TailoringAiService, useValue: mockTailoringAiService },
      ],
    }).compile();

    service = module.get<TailoringService>(TailoringService);

    jest.clearAllMocks();
    mockUserService.findByClerkId.mockResolvedValue(MOCK_USER);
    mockBillingService.getUserPlan.mockResolvedValue('pro');
    mockRepo.count.mockResolvedValue(0);
    mockRepo.create.mockReturnValue(MOCK_TAILORING);
    mockRepo.save.mockResolvedValue(MOCK_TAILORING);
    mockCvService.findById.mockResolvedValue(MOCK_CV);
  });

  // ─── submit() ─────────────────────────────────────────────────────────────────

  describe('submit()', () => {
    const validDto = {
      cvId: 'cv-1',
      jobTitle: 'Backend Engineer',
      companyName: 'TechCorp',
      jobDescription:
        'We are looking for an experienced backend engineer who knows Docker and APIs.',
    };

    it('throws ForbiddenException on free plan (tailoringsPerMonth = 0)', async () => {
      mockBillingService.getUserPlan.mockResolvedValue('free');

      await expect(service.submit('clerk-1', validDto)).rejects.toThrow(ForbiddenException);
      expect(mockRepo.save).not.toHaveBeenCalled();
    });

    it('throws ForbiddenException when CV belongs to another user', async () => {
      mockCvService.findById.mockResolvedValue({ ...MOCK_CV, userId: 'other-user' });

      await expect(service.submit('clerk-1', validDto)).rejects.toThrow(ForbiddenException);
      expect(mockRepo.save).not.toHaveBeenCalled();
    });

    it('throws UnprocessableEntityException when CV has no structured content', async () => {
      mockCvService.findById.mockResolvedValue({ ...MOCK_CV, content: undefined });

      await expect(service.submit('clerk-1', validDto)).rejects.toThrow(
        UnprocessableEntityException,
      );
      expect(mockRepo.save).not.toHaveBeenCalled();
    });

    it('creates tailoring record and enqueues job on success', async () => {
      const result = await service.submit('clerk-1', validDto);

      expect(mockRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-1',
          masterCvId: 'cv-1',
          jobTitle: 'Backend Engineer',
          status: 'pending',
        }),
      );
      expect(mockRepo.save).toHaveBeenCalled();
      expect(mockQueue.add).toHaveBeenCalledWith('run-tailoring', { tailoringId: 'tailor-1' });
      expect(result).toEqual(MOCK_TAILORING);
    });
  });

  // ─── findOneForUser() ─────────────────────────────────────────────────────────

  describe('findOneForUser()', () => {
    it('throws NotFoundException when tailoring does not belong to user', async () => {
      mockRepo.findOne.mockResolvedValue(null);

      await expect(service.findOneForUser('clerk-1', 'tailor-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('returns tailoring when found', async () => {
      mockRepo.findOne.mockResolvedValue(MOCK_DONE_TAILORING);

      const result = await service.findOneForUser('clerk-1', 'tailor-1');
      expect(result).toEqual(MOCK_DONE_TAILORING);
    });
  });

  // ─── apply() ─────────────────────────────────────────────────────────────────

  describe('apply()', () => {
    beforeEach(() => {
      mockRepo.findOne.mockResolvedValue(MOCK_DONE_TAILORING);
      mockCvService.findById.mockResolvedValue(MOCK_CV);
      mockCvService.createTailored.mockResolvedValue({ id: 'cv-tailored-1' });
      mockRepo.update.mockResolvedValue(undefined);
    });

    const validDto = {
      decisions: [
        { suggestionId: 's1', decision: 'accepted' as const },
        { suggestionId: 's2', decision: 'accepted' as const },
        { suggestionId: 's3', decision: 'rejected' as const },
      ],
    };

    it('throws UnprocessableEntityException when tailoring is not done', async () => {
      mockRepo.findOne.mockResolvedValue({ ...MOCK_TAILORING, status: 'pending' });

      await expect(service.apply('clerk-1', 'tailor-1', validDto)).rejects.toThrow(
        UnprocessableEntityException,
      );
      expect(mockCvService.createTailored).not.toHaveBeenCalled();
    });

    it('throws ConflictException when tailoring has already been applied', async () => {
      mockRepo.findOne.mockResolvedValue({ ...MOCK_DONE_TAILORING, tailoredCvId: 'cv-old' });

      await expect(service.apply('clerk-1', 'tailor-1', validDto)).rejects.toThrow(
        ConflictException,
      );
      expect(mockCvService.createTailored).not.toHaveBeenCalled();
    });

    it('creates tailored CV with accepted decisions applied', async () => {
      const result = await service.apply('clerk-1', 'tailor-1', validDto);

      expect(mockCvService.createTailored).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({
          // summary replaced by s1
          summary: 'Results-driven engineer with 3+ years in backend development.',
          // s3 was rejected — Docker NOT added
          skills: expect.not.arrayContaining([expect.objectContaining({ name: 'Docker' })]),
        }),
        'Backend Engineer',
      );
      expect(result).toEqual({ tailoredCvId: 'cv-tailored-1' });
    });

    it('replaces bullet text when workExperience suggestion is accepted', async () => {
      await service.apply('clerk-1', 'tailor-1', {
        decisions: [{ suggestionId: 's2', decision: 'accepted' }],
      });

      expect(mockCvService.createTailored).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({
          workExperience: [
            expect.objectContaining({
              bullets: expect.arrayContaining([
                'Designed and built RESTful APIs serving 50k requests/day',
              ]),
            }),
          ],
        }),
        'Backend Engineer',
      );
    });

    it('uses editedContent over suggestedContent when provided', async () => {
      const customText = 'My custom summary for this job.';
      await service.apply('clerk-1', 'tailor-1', {
        decisions: [{ suggestionId: 's1', decision: 'accepted', editedContent: customText }],
      });

      expect(mockCvService.createTailored).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({ summary: customText }),
        'Backend Engineer',
      );
    });

    it('updates tailoring record with applied status and tailoredCvId', async () => {
      await service.apply('clerk-1', 'tailor-1', validDto);

      expect(mockRepo.update).toHaveBeenCalledWith(
        'tailor-1',
        expect.objectContaining({
          tailoredCvId: 'cv-tailored-1',
          status: 'applied',
        }),
      );
    });
  });

  // ─── runTailoring() ───────────────────────────────────────────────────────────

  describe('runTailoring()', () => {
    beforeEach(() => {
      mockRepo.findOneByOrFail.mockResolvedValue(MOCK_TAILORING);
      mockTailoringAiService.runTailoring.mockResolvedValue({
        suggestions: MOCK_SUGGESTIONS,
        modelUsed: 'gpt-4o',
        tokensUsed: 500,
      });
      mockRepo.update.mockResolvedValue(undefined);
    });

    it('sets status to processing then done on success', async () => {
      await service.runTailoring('tailor-1');

      expect(mockRepo.update).toHaveBeenNthCalledWith(1, 'tailor-1', { status: 'processing' });
      expect(mockRepo.update).toHaveBeenNthCalledWith(
        2,
        'tailor-1',
        expect.objectContaining({ status: 'done' }),
      );
    });

    it('persists suggestions sorted by priority then section regardless of AI output order', async () => {
      // AI returns suggestions in a deliberately scrambled order
      const scrambled: TailoringSuggestion[] = [
        {
          id: 'x1',
          section: 'certifications',
          originalContent: '',
          suggestedContent: 'AWS cert',
          reason: 'Listed in JD.',
          priority: 'HIGH',
        },
        {
          id: 'x2',
          section: 'summary',
          originalContent: 'Engineer.',
          suggestedContent: 'Backend engineer with 3 years.',
          reason: 'More specific.',
          priority: 'LOW',
        },
        {
          id: 'x3',
          section: 'skills',
          originalContent: '',
          suggestedContent: 'Docker',
          reason: 'Required skill.',
          priority: 'HIGH',
        },
        {
          id: 'x4',
          section: 'workExperience',
          field: 'Acme | Engineer',
          originalContent: 'Built APIs',
          suggestedContent: 'Built REST APIs serving 50k rpm',
          reason: 'Adds quantifiable impact.',
          priority: 'MEDIUM',
        },
        {
          id: 'x5',
          section: 'education',
          originalContent: '',
          suggestedContent: 'Highlight relevant modules',
          reason: 'JD mentions education.',
          priority: 'HIGH',
        },
      ];

      mockTailoringAiService.runTailoring.mockResolvedValue({
        suggestions: scrambled,
        modelUsed: 'gpt-4o',
        tokensUsed: 400,
      });

      await service.runTailoring('tailor-1');

      const saved = (mockRepo.update.mock.calls[1] as unknown[])[1] as {
        suggestions: TailoringSuggestion[];
      };
      const ids = saved.suggestions.map((s) => s.id);

      // Expected order:
      //   HIGH:   workExperience (x3→skills first, then certifications, then education)
      //           Actually: HIGH + skills(2) < HIGH + education(3) < HIGH + certifications(5)
      //           x3 (HIGH/skills=2), x5 (HIGH/education=3), x1 (HIGH/certifications=5)
      //   MEDIUM: x4 (MEDIUM/workExperience=1)
      //   LOW:    x2 (LOW/summary=0)
      expect(ids).toEqual(['x3', 'x5', 'x1', 'x4', 'x2']);
    });

    it('sets status to failed when AI throws', async () => {
      mockTailoringAiService.runTailoring.mockRejectedValue(new Error('AI provider error'));

      await service.runTailoring('tailor-1');

      expect(mockRepo.update).toHaveBeenLastCalledWith('tailor-1', { status: 'failed' });
    });

    it('sets status to failed when master CV has no content', async () => {
      mockCvService.findById.mockResolvedValue({ ...MOCK_CV, content: undefined });

      await service.runTailoring('tailor-1');

      expect(mockRepo.update).toHaveBeenLastCalledWith('tailor-1', { status: 'failed' });
      expect(mockTailoringAiService.runTailoring).not.toHaveBeenCalled();
    });
  });
});
