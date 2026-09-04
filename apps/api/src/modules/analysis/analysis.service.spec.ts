import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { getQueueToken } from '@nestjs/bullmq';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  ForbiddenException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { Job } from 'bullmq';

import { AnalysisService } from './analysis.service';
import { AnalysisEntity } from '../../entities/analysis.entity';
import { AtsReportEntity } from '../../entities/ats-report.entity';
import { UserService } from '../user/user.service';
import { CvService } from '../cv/cv.service';
import { BillingService } from '../billing/billing.service';
import { AiService } from './ai.service';

const MOCK_USER = { id: 'user-1', clerkId: 'clerk-1' };

// Focused on the relation-loading change (History Phase 1) — not a full
// spec of submit()/process(), which are unaffected by this change.
describe('AnalysisService — history relation loading', () => {
  let service: AnalysisService;

  const mockAnalysisRepo = { find: jest.fn(), findOne: jest.fn() };
  const mockAtsRepo = { create: jest.fn(), save: jest.fn() };
  const mockQueue = { add: jest.fn() };
  const mockEventEmitter = { emit: jest.fn() };
  const mockUserService = { findByClerkId: jest.fn() };
  const mockCvService = { findById: jest.fn() };
  const mockBillingService = { canPerformAction: jest.fn() };
  const mockAiService = { runAnalysis: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnalysisService,
        { provide: getRepositoryToken(AnalysisEntity), useValue: mockAnalysisRepo },
        { provide: getRepositoryToken(AtsReportEntity), useValue: mockAtsRepo },
        { provide: getQueueToken('cv-analysis'), useValue: mockQueue },
        { provide: EventEmitter2, useValue: mockEventEmitter },
        { provide: UserService, useValue: mockUserService },
        { provide: CvService, useValue: mockCvService },
        { provide: BillingService, useValue: mockBillingService },
        { provide: AiService, useValue: mockAiService },
      ],
    }).compile();

    service = module.get<AnalysisService>(AnalysisService);
    mockUserService.findByClerkId.mockResolvedValue(MOCK_USER);
  });

  describe('listForUser()', () => {
    it('requests both the atsReport and cv relations', async () => {
      mockAnalysisRepo.find.mockResolvedValue([]);

      await service.listForUser('clerk-1');

      expect(mockAnalysisRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'user-1' },
          relations: ['atsReport', 'cv'],
        }),
      );
    });

    it('returns analyses with their cv relation populated when the source CV still exists', async () => {
      const withCv = {
        id: 'an-1',
        cv: { id: 'cv-1', title: 'My CV', fileName: undefined, source: 'builder' },
      };
      mockAnalysisRepo.find.mockResolvedValue([withCv]);

      const result = await service.listForUser('clerk-1');

      expect(result[0]?.cv).toEqual(withCv.cv);
    });

    it('tolerates a missing cv relation (source CV since deleted) without throwing', async () => {
      mockAnalysisRepo.find.mockResolvedValue([{ id: 'an-1', cv: undefined }]);

      const result = await service.listForUser('clerk-1');

      expect(result[0]?.cv).toBeUndefined();
    });
  });

  describe('findOneForUser()', () => {
    it('requests both the atsReport and cv relations', async () => {
      mockAnalysisRepo.findOne.mockResolvedValue({ id: 'an-1', userId: 'user-1' });

      await service.findOneForUser('clerk-1', 'an-1');

      expect(mockAnalysisRepo.findOne).toHaveBeenCalledWith({
        where: { id: 'an-1', userId: 'user-1' },
        relations: ['atsReport', 'cv'],
      });
    });

    it('throws NotFoundException for a non-owned or non-existent analysis id', async () => {
      mockAnalysisRepo.findOne.mockResolvedValue(null);

      await expect(service.findOneForUser('clerk-1', 'not-mine')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});

// ─── submit() / process() — CV validation and recommendation grounding ────────
//
// Covers the "Analysis reliability" pre-launch task: (a) Analysis is
// intentionally scoped to uploaded, parsed CVs — unlike Cover Letter, it
// does not accept structured-only builder/prefill/tailored CVs, since the
// frontend (AnalysisWorkspace.tsx) only ever offers uploaded CVs and directs
// users to Job Tailoring otherwise; and (b) recommendations returned by the
// AI are passed through groundSuggestions() (recommendation-grounding.util.ts)
// before being persisted.
describe('AnalysisService — submit() / process()', () => {
  let service: AnalysisService;

  const MOCK_CV = {
    id: 'cv-1',
    userId: 'user-1',
    source: 'upload',
    parseStatus: 'done',
    parsedContent:
      'Experienced backend engineer with 5 years of Node.js and PostgreSQL experience.',
  };

  const mockAnalysisRepo = {
    create: jest.fn(),
    save: jest.fn(),
    update: jest.fn(),
    findOneByOrFail: jest.fn(),
  };
  const mockAtsRepo = { create: jest.fn(), save: jest.fn() };
  const mockQueue = { add: jest.fn() };
  const mockEventEmitter = { emit: jest.fn() };
  const mockUserService = { findByClerkId: jest.fn() };
  const mockCvService = { findById: jest.fn() };
  const mockBillingService = { canPerformAction: jest.fn() };
  const mockAiService = { runAnalysis: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnalysisService,
        { provide: getRepositoryToken(AnalysisEntity), useValue: mockAnalysisRepo },
        { provide: getRepositoryToken(AtsReportEntity), useValue: mockAtsRepo },
        { provide: getQueueToken('cv-analysis'), useValue: mockQueue },
        { provide: EventEmitter2, useValue: mockEventEmitter },
        { provide: UserService, useValue: mockUserService },
        { provide: CvService, useValue: mockCvService },
        { provide: BillingService, useValue: mockBillingService },
        { provide: AiService, useValue: mockAiService },
      ],
    }).compile();

    service = module.get<AnalysisService>(AnalysisService);

    mockUserService.findByClerkId.mockResolvedValue(MOCK_USER);
    mockCvService.findById.mockResolvedValue(MOCK_CV);
    mockBillingService.canPerformAction.mockResolvedValue(true);
    mockAnalysisRepo.create.mockImplementation((v: unknown) => v);
    mockAnalysisRepo.save.mockImplementation((v: unknown) => ({
      id: 'analysis-1',
      ...(v as object),
    }));
    mockQueue.add.mockResolvedValue({ id: 'job-1' });
  });

  // ─── submit() — CV validation ────────────────────────────────────────────

  it('throws ForbiddenException when the CV does not belong to the requesting user', async () => {
    mockCvService.findById.mockResolvedValue({ ...MOCK_CV, userId: 'other-user' });

    await expect(
      service.submit('clerk-1', {
        cvId: 'cv-1',
        jobTitle: 'Engineer',
        jobDescription: 'a'.repeat(60),
      }),
    ).rejects.toThrow(ForbiddenException);
  });

  // (D) Genuinely unparsed/empty CV: remains rejected.
  it('(D) throws UnprocessableEntityException with the "still being parsed" message for a genuinely unparsed CV', async () => {
    mockCvService.findById.mockResolvedValue({
      ...MOCK_CV,
      parseStatus: 'pending',
      parsedContent: undefined,
    });

    await expect(
      service.submit('clerk-1', {
        cvId: 'cv-1',
        jobTitle: 'Engineer',
        jobDescription: 'a'.repeat(60),
      }),
    ).rejects.toThrow(UnprocessableEntityException);
  });

  // (B) Structured builder/prefill CV: current product architecture does NOT
  // support analysis of structured-only content (see the comment above
  // AnalysisService.submit()'s parsedContent check) — this documents that
  // deliberate decision with an accurate, non-misleading rejection message,
  // distinct from the "still being parsed" case above.
  it('(B) rejects a structured-only builder/prefill/tailored CV with an accurate message — analysis does not (yet) support structured content', async () => {
    mockCvService.findById.mockResolvedValue({
      ...MOCK_CV,
      source: 'prefill',
      parseStatus: 'done', // set immediately for builder/prefill/tailored CVs — never "still parsing"
      parsedContent: undefined,
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

    await expect(
      service.submit('clerk-1', {
        cvId: 'cv-1',
        jobTitle: 'Engineer',
        jobDescription: 'a'.repeat(60),
      }),
    ).rejects.toThrow(UnprocessableEntityException);
    await expect(
      service.submit('clerk-1', {
        cvId: 'cv-1',
        jobTitle: 'Engineer',
        jobDescription: 'a'.repeat(60),
      }),
    ).rejects.toMatchObject({
      message: expect.stringContaining('Job Tailoring') as unknown as string,
    });
  });

  // (A) Parsed uploaded CV still analyzes successfully.
  it('(A) creates the analysis and enqueues the job for a normally parsed uploaded CV', async () => {
    const saved = await service.submit('clerk-1', {
      cvId: 'cv-1',
      jobTitle: 'Backend Engineer',
      jobDescription: 'a'.repeat(60),
    });

    expect(saved.status).toBe('pending');
    expect(mockQueue.add).toHaveBeenCalledWith(
      'run-analysis',
      expect.objectContaining({ cvId: 'cv-1' }),
    );
  });

  it('throws ForbiddenException when the monthly analysis limit is reached', async () => {
    mockBillingService.canPerformAction.mockResolvedValue(false);

    await expect(
      service.submit('clerk-1', {
        cvId: 'cv-1',
        jobTitle: 'Engineer',
        jobDescription: 'a'.repeat(60),
      }),
    ).rejects.toThrow(ForbiddenException);
  });

  // ─── process() — recommendation grounding ────────────────────────────────

  function runProcess(analysisId = 'analysis-1', cvId = 'cv-1') {
    return service.process({
      data: { analysisId, cvId },
    } as unknown as Job<{ analysisId: string; cvId: string }>);
  }

  beforeEach(() => {
    mockAnalysisRepo.findOneByOrFail.mockResolvedValue({
      id: 'analysis-1',
      jobDescription: 'Looking for a backend engineer with Kubernetes experience.',
    });
  });

  // (E) Missing JD requirement with no CV evidence: recommendation must not
  // state or imply possession — conditional wording is allowed.
  it('(E) persists a grounded (rewritten) suggestion rather than the raw AI text when it asserts an ungrounded keyword', async () => {
    mockAiService.runAnalysis.mockResolvedValue({
      result: {
        match_score: 75,
        suggestions: [
          { category: 'MISSING_KEYWORD', priority: 'HIGH', text: 'Add "Kubernetes" to your CV.' },
          {
            category: 'WEAK_LANGUAGE',
            priority: 'MEDIUM',
            text: 'Tighten up your summary wording.',
          },
          {
            category: 'STRUCTURE',
            priority: 'LOW',
            text: 'Move your summary above work experience.',
          },
        ],
        ats_keywords: [{ keyword: 'Kubernetes', found: false }],
      },
      modelUsed: 'gpt-4o',
      tokensUsed: 300,
    });

    await runProcess();

    const [, updatePayload] = mockAnalysisRepo.update.mock.calls.find(
      ([, payload]) => (payload as { status?: string }).status === 'done',
    ) as [string, { suggestions: Array<{ text: string }> }];
    const persisted = updatePayload.suggestions;

    const kubernetesSuggestion = persisted.find((s) => s.text.toLowerCase().includes('kubernetes'));
    expect(kubernetesSuggestion?.text).not.toBe('Add "Kubernetes" to your CV.');
    expect(kubernetesSuggestion?.text.toLowerCase()).toContain('if you genuinely have');
  });

  // (F) Existing CV evidence: analysis can recommend strengthening/rephrasing
  // it without inventing facts — the suggestion must survive unchanged.
  it('(F) leaves a suggestion about content genuinely present in the CV unchanged', async () => {
    mockAiService.runAnalysis.mockResolvedValue({
      result: {
        match_score: 80,
        suggestions: [
          {
            category: 'WEAK_LANGUAGE',
            priority: 'MEDIUM',
            text: 'Your Node.js experience is understated — quantify the scale of what you built.',
          },
          { category: 'STRUCTURE', priority: 'LOW', text: 'Consider adding a Skills section.' },
          {
            category: 'MISSING_KEYWORD',
            priority: 'LOW',
            text: 'Generic filler suggestion text here.',
          },
        ],
        ats_keywords: [{ keyword: 'Node.js', found: true }],
      },
      modelUsed: 'gpt-4o',
      tokensUsed: 200,
    });

    await runProcess();

    const [, updatePayload] = mockAnalysisRepo.update.mock.calls.find(
      ([, payload]) => (payload as { status?: string }).status === 'done',
    ) as [string, { suggestions: Array<{ text: string }> }];

    expect(
      updatePayload.suggestions.some((s) =>
        s.text.includes('Your Node.js experience is understated'),
      ),
    ).toBe(true);
  });

  // (G) Formatting: analysis must not claim unsupported visual/formatting
  // problems in the persisted suggestions.
  it('(G) drops a suggestion claiming a visual/formatting detail plain text cannot establish', async () => {
    mockAiService.runAnalysis.mockResolvedValue({
      result: {
        match_score: 60,
        suggestions: [
          {
            category: 'STRUCTURE',
            priority: 'MEDIUM',
            text: 'Your CV uses a two-column table layout that confuses ATS parsers.',
          },
          {
            category: 'WEAK_LANGUAGE',
            priority: 'LOW',
            text: 'Use stronger action verbs throughout.',
          },
          {
            category: 'MISSING_KEYWORD',
            priority: 'LOW',
            text: 'Another generic filler suggestion.',
          },
        ],
        ats_keywords: [],
      },
      modelUsed: 'gpt-4o',
      tokensUsed: 150,
    });

    await runProcess();

    const [, updatePayload] = mockAnalysisRepo.update.mock.calls.find(
      ([, payload]) => (payload as { status?: string }).status === 'done',
    ) as [string, { suggestions: Array<{ text: string }> }];

    expect(updatePayload.suggestions.some((s) => s.text.includes('two-column table'))).toBe(false);
  });

  // (H) Recommendation duplication: obvious duplicates are filtered.
  it('(H) collapses two suggestions about the same missing keyword before persisting', async () => {
    mockAiService.runAnalysis.mockResolvedValue({
      result: {
        match_score: 70,
        suggestions: [
          { category: 'MISSING_KEYWORD', priority: 'HIGH', text: 'Add Kubernetes to your CV.' },
          {
            category: 'MISSING_KEYWORD',
            priority: 'HIGH',
            text: 'Include Kubernetes as a skill you have used.',
          },
          { category: 'STRUCTURE', priority: 'LOW', text: 'Consider a clearer section order.' },
        ],
        ats_keywords: [{ keyword: 'Kubernetes', found: false }],
      },
      modelUsed: 'gpt-4o',
      tokensUsed: 180,
    });

    await runProcess();

    const [, updatePayload] = mockAnalysisRepo.update.mock.calls.find(
      ([, payload]) => (payload as { status?: string }).status === 'done',
    ) as [string, { suggestions: Array<{ text: string }> }];

    const kubernetesMentions = updatePayload.suggestions.filter((s) =>
      s.text.toLowerCase().includes('kubernetes'),
    );
    expect(kubernetesMentions).toHaveLength(1);
  });

  it('does not alter match_score or ats_keywords/atsScore based on recommendation grounding', async () => {
    mockAiService.runAnalysis.mockResolvedValue({
      result: {
        match_score: 65,
        suggestions: [
          { category: 'MISSING_KEYWORD', priority: 'HIGH', text: 'Add Kubernetes to your CV.' },
          { category: 'WEAK_LANGUAGE', priority: 'LOW', text: 'Tighten the summary wording.' },
          { category: 'STRUCTURE', priority: 'LOW', text: 'Reorder your sections.' },
        ],
        ats_keywords: [{ keyword: 'Kubernetes', found: false }],
      },
      modelUsed: 'gpt-4o',
      tokensUsed: 220,
    });

    await runProcess();

    const [, updatePayload] = mockAnalysisRepo.update.mock.calls.find(
      ([, payload]) => (payload as { status?: string }).status === 'done',
    ) as [string, { matchScore: number }];
    expect(updatePayload.matchScore).toBe(65);

    expect(mockAtsRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        missingKeywords: ['Kubernetes'],
        atsScore: 0,
      }),
    );
  });

  it('marks the analysis failed and never persists suggestions when the CV has no parsed content at process time', async () => {
    mockCvService.findById.mockResolvedValue({ ...MOCK_CV, parsedContent: undefined });

    await runProcess();

    expect(mockAiService.runAnalysis).not.toHaveBeenCalled();
    expect(mockAnalysisRepo.update).toHaveBeenCalledWith('analysis-1', { status: 'failed' });
  });
});
