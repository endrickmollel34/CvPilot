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
import type { CvContent, TailoringDecision, TailoringSuggestion } from '@cvpilot/shared';

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

// A CV with no mention of Python, Java, REST APIs, MySQL, Git, or Docker
// anywhere (summary, bullets, education, skills) — used to prove those six
// job-description technologies cannot be added when unsupported by the CV.
const PLAIN_CONTENT: CvContent = {
  version: 1,
  personalDetails: { fullName: 'Sam Lee', email: 'sam@example.com' },
  summary: 'Customer-focused retail supervisor with a track record of hitting sales targets.',
  workExperience: [
    {
      id: 'we-2',
      company: 'Northwind Retail',
      title: 'Store Supervisor',
      startDate: '2021-03',
      current: true,
      bullets: [
        'Trained and scheduled a team of 8 sales associates',
        'Managed inventory counts and vendor orders',
      ],
    },
  ],
  education: [{ id: 'ed-1', institution: 'City College', degree: 'BA Business Studies' }],
  skills: [{ id: 'sk-2', name: 'Customer Service' }],
  languages: [],
  certifications: [],
  sectionOrder: ['summary', 'workExperience', 'education', 'skills', 'languages', 'certifications'],
};

const PLAIN_CV = { id: 'cv-2', userId: 'user-1', content: PLAIN_CONTENT };

const UNSUPPORTED_TECH_SUGGESTIONS: TailoringSuggestion[] = [
  {
    id: 'u1',
    section: 'skills',
    originalContent: '',
    suggestedContent: 'Python',
    reason: 'The job description requires Python.',
    priority: 'HIGH',
  },
  {
    id: 'u2',
    section: 'skills',
    originalContent: '',
    suggestedContent: 'Java',
    reason: 'The job description requires Java.',
    priority: 'HIGH',
    // Real CV text, but unrelated to Java — must still be rejected.
    evidence: 'Trained and scheduled a team of 8 sales associates',
  },
  {
    id: 'u3',
    section: 'skills',
    originalContent: '',
    suggestedContent: 'REST APIs',
    reason: 'The job description requires REST API experience.',
    priority: 'MEDIUM',
  },
  {
    id: 'u4',
    section: 'skills',
    originalContent: '',
    suggestedContent: 'MySQL',
    reason: 'The job description requires MySQL.',
    priority: 'MEDIUM',
    // Fabricated evidence — this sentence is not in the CV at all.
    evidence: 'We need someone who knows MySQL well',
  },
  {
    id: 'u5',
    section: 'skills',
    originalContent: '',
    suggestedContent: 'Git',
    reason: 'The job description requires Git.',
    priority: 'LOW',
  },
  {
    id: 'u6',
    section: 'skills',
    originalContent: '',
    suggestedContent: 'Docker',
    reason: 'The job description requires Docker.',
    priority: 'LOW',
  },
];

const UNSUPPORTED_TECH_NAMES = ['Python', 'Java', 'REST APIs', 'MySQL', 'Git', 'Docker'];

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

  // ─── listForUser() (History Phase 2) ───────────────────────────────────────────

  describe('listForUser()', () => {
    it('scopes the query to the requesting user and requests both CV relations in a single batched query', async () => {
      mockRepo.find.mockResolvedValue([]);

      await service.listForUser('clerk-1');

      expect(mockRepo.find).toHaveBeenCalledTimes(1);
      expect(mockRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'user-1' },
          relations: ['masterCv', 'tailoredCv'],
        }),
      );
    });

    it('returns masterCv and tailoredCv metadata when both CVs still exist', async () => {
      const withCvs = {
        ...MOCK_DONE_TAILORING,
        masterCv: { id: 'cv-1', title: 'My Master CV', fileName: undefined, source: 'builder' },
        tailoredCv: {
          id: 'cv-tailored-1',
          title: 'Tailored — Backend Engineer',
          source: 'tailored',
        },
      };
      mockRepo.find.mockResolvedValue([withCvs]);

      const result = await service.listForUser('clerk-1');

      expect(result[0]?.masterCv).toEqual(withCvs.masterCv);
      expect(result[0]?.tailoredCv).toEqual(withCvs.tailoredCv);
    });

    it('tolerates a missing masterCv or tailoredCv (deleted source/result CV) without throwing', async () => {
      mockRepo.find.mockResolvedValue([
        { ...MOCK_DONE_TAILORING, masterCv: undefined, tailoredCv: undefined },
      ]);

      const result = await service.listForUser('clerk-1');

      expect(result[0]?.masterCv).toBeUndefined();
      expect(result[0]?.tailoredCv).toBeUndefined();
    });

    it("never exposes another user's CV — the query is scoped by the tailoring's own userId, and masterCvId/tailoredCvId are only ever set to that user's own CVs at write time", async () => {
      // The relation can only resolve to a CV row whose id equals this
      // tailoring's own masterCvId/tailoredCvId, both of which are set
      // exclusively by submit()/apply() to CVs already ownership-checked
      // against this same user. There is no code path where a tailoring
      // row's FK could point at another user's CV.
      mockRepo.find.mockResolvedValue([MOCK_DONE_TAILORING]);

      await service.listForUser('clerk-1');

      expect(mockUserService.findByClerkId).toHaveBeenCalledWith('clerk-1');
      expect(mockRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: 'user-1' } }),
      );
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

    it('requests both the masterCv and tailoredCv relations', async () => {
      mockRepo.findOne.mockResolvedValue(MOCK_DONE_TAILORING);

      await service.findOneForUser('clerk-1', 'tailor-1');

      expect(mockRepo.findOne).toHaveBeenCalledWith({
        where: { id: 'tailor-1', userId: 'user-1' },
        relations: ['masterCv', 'tailoredCv'],
      });
    });

    it('returns applied-status tailoring with its decisions and resulting tailoredCv metadata intact', async () => {
      const applied = {
        ...MOCK_DONE_TAILORING,
        status: 'applied',
        tailoredCvId: 'cv-tailored-1',
        tailoredCv: {
          id: 'cv-tailored-1',
          title: 'Tailored — Backend Engineer',
          source: 'tailored',
        },
        decisions: [
          { suggestionId: 's1', decision: 'accepted' },
          { suggestionId: 's2', decision: 'accepted' },
          { suggestionId: 's3', decision: 'rejected' },
        ],
      };
      mockRepo.findOne.mockResolvedValue(applied);

      const result = await service.findOneForUser('clerk-1', 'tailor-1');

      expect(result.status).toBe('applied');
      expect(result.decisions).toEqual(applied.decisions);
      expect(result.tailoredCv).toEqual(applied.tailoredCv);
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

    // ─── Grounding: apply-time enforcement (defense in depth) ────────────────

    it('promotes a genuinely supported skill into the Skills section when accepted', async () => {
      mockRepo.findOne.mockResolvedValue({
        ...MOCK_DONE_TAILORING,
        suggestions: [
          {
            id: 'g1',
            section: 'skills',
            originalContent: '',
            suggestedContent: 'REST APIs',
            evidence: 'Built REST APIs',
            reason: 'Matches a required skill in the JD.',
            priority: 'HIGH',
          },
        ],
      });

      await service.apply('clerk-1', 'tailor-1', {
        decisions: [{ suggestionId: 'g1', decision: 'accepted' }],
      });

      expect(mockCvService.createTailored).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({
          skills: expect.arrayContaining([expect.objectContaining({ name: 'REST APIs' })]),
        }),
        'Backend Engineer',
      );
    });

    it('blocks a stored ungrounded skill suggestion even when the user accepts it', async () => {
      // s3 ('Docker', no evidence) is already part of MOCK_DONE_TAILORING —
      // simulates a suggestion that was somehow persisted ungrounded (e.g.
      // stored before this check existed). Accepting it must not add it.
      await service.apply('clerk-1', 'tailor-1', {
        decisions: [{ suggestionId: 's3', decision: 'accepted' }],
      });

      expect(mockCvService.createTailored).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({
          skills: expect.not.arrayContaining([expect.objectContaining({ name: 'Docker' })]),
        }),
        'Backend Engineer',
      );
    });

    it('regression: "Accept all" cannot inject unsupported job-description technologies', async () => {
      // Simulates the frontend's "Accept all" button, which sends every
      // suggestion as accepted regardless of content.
      mockCvService.findById.mockResolvedValue(PLAIN_CV);
      mockRepo.findOne.mockResolvedValue({
        ...MOCK_DONE_TAILORING,
        masterCvId: 'cv-2',
        suggestions: UNSUPPORTED_TECH_SUGGESTIONS,
      });
      const acceptAllDecisions: TailoringDecision[] = UNSUPPORTED_TECH_SUGGESTIONS.map((s) => ({
        suggestionId: s.id,
        decision: 'accepted',
      }));

      await service.apply('clerk-1', 'tailor-1', { decisions: acceptAllDecisions });

      const [, tailoredContentArg] = mockCvService.createTailored.mock.calls[0] as [
        string,
        CvContent,
        string?,
      ];
      const skillNames = tailoredContentArg.skills.map((s) => s.name);
      for (const tech of UNSUPPORTED_TECH_NAMES) {
        expect(skillNames).not.toContain(tech);
      }
      // Only the CV's original, pre-existing skill remains.
      expect(skillNames).toEqual(['Customer Service']);
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
          suggestedContent: 'REST APIs',
          // Grounded in MOCK_CONTENT's 'Built REST APIs' bullet — this test
          // is about sort order, not grounding, so the fixture must survive
          // the grounding filter to keep testing what it says it tests.
          evidence: 'Built REST APIs',
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

    // ─── Grounding: generation-time filtering ────────────────────────────────

    it('drops Python/Java/REST APIs/MySQL/Git/Docker skill suggestions when none is supported by the source CV', async () => {
      mockCvService.findById.mockResolvedValue(PLAIN_CV);
      mockTailoringAiService.runTailoring.mockResolvedValue({
        suggestions: UNSUPPORTED_TECH_SUGGESTIONS,
        modelUsed: 'gpt-4o',
        tokensUsed: 300,
      });

      await service.runTailoring('tailor-1');

      const saved = (mockRepo.update.mock.calls[1] as unknown[])[1] as {
        suggestions: TailoringSuggestion[];
      };
      const persistedNames = saved.suggestions.map((s) => s.suggestedContent);
      for (const tech of UNSUPPORTED_TECH_NAMES) {
        expect(persistedNames).not.toContain(tech);
      }
      expect(saved.suggestions).toHaveLength(0);
    });

    it('keeps a skill suggestion that is genuinely grounded in the source CV', async () => {
      mockTailoringAiService.runTailoring.mockResolvedValue({
        suggestions: [
          {
            id: 'g1',
            section: 'skills',
            originalContent: '',
            suggestedContent: 'REST APIs',
            evidence: 'Built REST APIs',
            reason: 'Matches a required skill in the JD.',
            priority: 'HIGH',
          },
        ],
        modelUsed: 'gpt-4o',
        tokensUsed: 150,
      });

      await service.runTailoring('tailor-1');

      const saved = (mockRepo.update.mock.calls[1] as unknown[])[1] as {
        suggestions: TailoringSuggestion[];
      };
      expect(saved.suggestions.map((s) => s.suggestedContent)).toEqual(['REST APIs']);
    });

    it('completes successfully with status "done" when the AI legitimately returns zero suggestions', async () => {
      // e.g. a CV that already matches the job description well, or one
      // where grounding leaves nothing safe to suggest.
      mockTailoringAiService.runTailoring.mockResolvedValue({
        suggestions: [],
        modelUsed: 'gpt-4o',
        tokensUsed: 180,
      });

      await service.runTailoring('tailor-1');

      expect(mockRepo.update).toHaveBeenLastCalledWith(
        'tailor-1',
        expect.objectContaining({
          suggestions: [],
          modelUsed: 'gpt-4o',
          tokensUsed: 180,
          status: 'done',
        }),
      );
      // Must not be treated as a provider failure.
      expect(mockRepo.update).not.toHaveBeenCalledWith('tailor-1', { status: 'failed' });
    });
  });
});
