import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { getRepositoryToken, getDataSourceToken } from '@nestjs/typeorm';
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
import { AuditService } from '../audit/audit.service';
import { AiService } from './ai.service';

const MOCK_USER = { id: 'user-1', clerkId: 'clerk-1' };

// Focused on the relation-loading change (History Phase 1) — not a full
// spec of submit()/process(), which are unaffected by this change.
describe('AnalysisService — history relation loading', () => {
  let service: AnalysisService;

  const mockAnalysisRepo = { find: jest.fn(), findOne: jest.fn(), delete: jest.fn() };
  const mockQueue = { add: jest.fn() };
  const mockEventEmitter = { emit: jest.fn() };
  const mockUserService = { findByClerkId: jest.fn() };
  const mockCvService = { findById: jest.fn() };
  const mockBillingService = { canPerformAction: jest.fn() };
  const mockAuditService = { log: jest.fn(), logTransactional: jest.fn() };
  const mockAiService = { runAnalysis: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnalysisService,
        { provide: getRepositoryToken(AnalysisEntity), useValue: mockAnalysisRepo },
        { provide: getQueueToken('cv-analysis'), useValue: mockQueue },
        { provide: EventEmitter2, useValue: mockEventEmitter },
        { provide: UserService, useValue: mockUserService },
        { provide: CvService, useValue: mockCvService },
        { provide: BillingService, useValue: mockBillingService },
        { provide: AuditService, useValue: mockAuditService },
        { provide: AiService, useValue: mockAiService },
        // Not exercised by these tests (this block covers listForUser()/
        // findOneForUser()/deleteAnalysis(), never process()) — a minimal
        // stub is enough to satisfy the constructor.
        { provide: getDataSourceToken(), useValue: { transaction: jest.fn() } },
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

  // ─── deleteAnalysis() ───────────────────────────────────────────────────────
  // Genuine hard delete — see the doc comment on deleteAnalysis() itself for
  // the ats_reports CASCADE / cover_letters SET NULL / cv_id-is-the-child-FK
  // reasoning that makes this safe without any application-level cleanup.

  describe('deleteAnalysis()', () => {
    it("deletes the caller's own analysis by id after the ownership lookup", async () => {
      mockAnalysisRepo.findOne.mockResolvedValue({ id: 'an-1', userId: 'user-1' });
      mockAnalysisRepo.delete.mockResolvedValue({ affected: 1 });

      await service.deleteAnalysis('clerk-1', 'an-1');

      expect(mockAnalysisRepo.findOne).toHaveBeenCalledWith({
        where: { id: 'an-1', userId: 'user-1' },
        relations: ['atsReport', 'cv'],
      });
      expect(mockAnalysisRepo.delete).toHaveBeenCalledWith('an-1');
    });

    it('throws NotFoundException and never deletes when the analysis belongs to another user', async () => {
      mockAnalysisRepo.findOne.mockResolvedValue(null);

      await expect(service.deleteAnalysis('clerk-1', 'an-1')).rejects.toThrow(NotFoundException);
      expect(mockAnalysisRepo.delete).not.toHaveBeenCalled();
    });

    it('a repeat delete 404s via the same ownership lookup, once the row is gone', async () => {
      mockAnalysisRepo.findOne
        .mockResolvedValueOnce({ id: 'an-1', userId: 'user-1' })
        .mockResolvedValueOnce(null);
      mockAnalysisRepo.delete.mockResolvedValue({ affected: 1 });

      await service.deleteAnalysis('clerk-1', 'an-1');
      await expect(service.deleteAnalysis('clerk-1', 'an-1')).rejects.toThrow(NotFoundException);
      expect(mockAnalysisRepo.delete).toHaveBeenCalledTimes(1);
    });

    it('only deletes the targeted analysis by its own id — never touches unrelated analyses', async () => {
      mockAnalysisRepo.findOne.mockResolvedValue({ id: 'an-2', userId: 'user-1' });
      mockAnalysisRepo.delete.mockResolvedValue({ affected: 1 });

      await service.deleteAnalysis('clerk-1', 'an-2');

      expect(mockAnalysisRepo.delete).toHaveBeenCalledWith('an-2');
      expect(mockAnalysisRepo.delete).not.toHaveBeenCalledWith('an-1');
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
  const mockQueue = { add: jest.fn() };
  const mockEventEmitter = { emit: jest.fn() };
  const mockUserService = { findByClerkId: jest.fn() };
  const mockCvService = { findById: jest.fn() };
  const mockBillingService = { canPerformAction: jest.fn() };
  const mockAuditService = { log: jest.fn(), logTransactional: jest.fn() };
  const mockAiService = { runAnalysis: jest.fn() };
  // Reliability fix: process()'s success path now writes the analysis
  // result, its ATS report, and the audit usage event inside one short DB
  // transaction (see analysis.service.ts) — mirrors the
  // dataSource.transaction() mocking pattern already used elsewhere in this
  // codebase (cv.service.spec.ts, user.service.spec.ts).
  const mockManager = { update: jest.fn(), create: jest.fn(), save: jest.fn() };
  const mockDataSource = {
    transaction: jest.fn(async (cb: (manager: typeof mockManager) => Promise<void>) =>
      cb(mockManager),
    ),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnalysisService,
        { provide: getRepositoryToken(AnalysisEntity), useValue: mockAnalysisRepo },
        { provide: getQueueToken('cv-analysis'), useValue: mockQueue },
        { provide: EventEmitter2, useValue: mockEventEmitter },
        { provide: UserService, useValue: mockUserService },
        { provide: CvService, useValue: mockCvService },
        { provide: BillingService, useValue: mockBillingService },
        { provide: AuditService, useValue: mockAuditService },
        { provide: AiService, useValue: mockAiService },
        { provide: getDataSourceToken(), useValue: mockDataSource },
      ],
    }).compile();

    service = module.get<AnalysisService>(AnalysisService);

    mockUserService.findByClerkId.mockResolvedValue(MOCK_USER);
    mockCvService.findById.mockResolvedValue(MOCK_CV);
    mockBillingService.canPerformAction.mockResolvedValue(true);
    mockManager.create.mockImplementation((_entity: unknown, v: unknown) => v);
    mockDataSource.transaction.mockImplementation(
      async (cb: (manager: typeof mockManager) => Promise<void>) => cb(mockManager),
    );
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

    const [, , updatePayload] = mockManager.update.mock.calls.find(
      ([, , payload]) => (payload as { status?: string }).status === 'done',
    ) as [unknown, string, { suggestions: Array<{ text: string }> }];
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

    const [, , updatePayload] = mockManager.update.mock.calls.find(
      ([, , payload]) => (payload as { status?: string }).status === 'done',
    ) as [unknown, string, { suggestions: Array<{ text: string }> }];

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

    const [, , updatePayload] = mockManager.update.mock.calls.find(
      ([, , payload]) => (payload as { status?: string }).status === 'done',
    ) as [unknown, string, { suggestions: Array<{ text: string }> }];

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

    const [, , updatePayload] = mockManager.update.mock.calls.find(
      ([, , payload]) => (payload as { status?: string }).status === 'done',
    ) as [unknown, string, { suggestions: Array<{ text: string }> }];

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

    const [, , updatePayload] = mockManager.update.mock.calls.find(
      ([, , payload]) => (payload as { status?: string }).status === 'done',
    ) as [unknown, string, { matchScore: number }];
    expect(updatePayload.matchScore).toBe(65);

    expect(mockManager.create).toHaveBeenCalledWith(
      AtsReportEntity,
      expect.objectContaining({
        missingKeywords: ['Kubernetes'],
        atsScore: 0,
      }),
    );
  });

  // ─── ATS Keyword Quality V2 — production-shaped regression ────────────────
  // Reproduces the exact reported Backend Software Engineer production case:
  // a JD-derived keyword list mixing concrete hard skills, technical
  // concepts, a role/title phrase, soft skills, and bare generic verbs — for
  // a CV that only genuinely supports PostgreSQL (via MOCK_CV.parsedContent,
  // 'Experienced backend engineer with 5 years of Node.js and PostgreSQL
  // experience.'), missing nearly every real technical requirement.
  it('production regression: meaningful technical requirements dominate ATS scoring, generic/soft noise does not, and recommendations are not flooded', async () => {
    const productionKeywords = [
      { keyword: 'Python', found: false },
      { keyword: 'Java', found: false },
      { keyword: 'TypeScript', found: false },
      { keyword: 'REST APIs', found: false },
      { keyword: 'PostgreSQL', found: true }, // genuinely supported
      { keyword: 'MySQL', found: false },
      { keyword: 'Git', found: false },
      { keyword: 'Docker', found: false },
      { keyword: 'authentication', found: false },
      { keyword: 'database design', found: false },
      { keyword: 'cloud platforms', found: false },
      { keyword: 'CI/CD', found: false },
      { keyword: 'automated testing', found: false },
      { keyword: 'Redis', found: false },
      { keyword: 'message queues', found: false },
      { keyword: 'microservices', found: false },
      { keyword: 'AI API integrations', found: false },
      { keyword: 'problem solving', found: false },
      { keyword: 'communication', found: false },
      { keyword: 'attention to detail', found: false },
      { keyword: 'developing', found: false },
      { keyword: 'maintaining', found: false },
      { keyword: 'designing', found: false },
      { keyword: 'testing', found: false },
    ];

    mockAiService.runAnalysis.mockResolvedValue({
      result: {
        match_score: 55,
        suggestions: [
          ...productionKeywords
            .filter((k) => !k.found)
            .map((k, i) => ({
              category: 'MISSING_KEYWORD' as const,
              priority: 'MEDIUM' as const,
              text: `If you have experience with ${k.keyword}, add a concrete example of it. (${i})`,
            })),
          {
            category: 'STRUCTURE',
            priority: 'LOW',
            text: 'Consider adding a dedicated Skills section.',
          },
        ],
        ats_keywords: productionKeywords,
      },
      modelUsed: 'gpt-4o',
      tokensUsed: 400,
    });

    await runProcess();

    const [, atsPayload] = mockManager.create.mock.calls[0] as [
      unknown,
      { missingKeywords: string[]; keywordHits: Array<{ keyword: string }>; atsScore: number },
    ];

    // Generic verbs never appear as high-value (or any) ATS requirement.
    for (const verb of ['developing', 'maintaining', 'designing', 'testing']) {
      expect(atsPayload.missingKeywords).not.toContain(verb);
      expect(atsPayload.keywordHits.map((k) => k.keyword)).not.toContain(verb);
    }

    // Missing technical requirements remain visible.
    expect(atsPayload.missingKeywords).toEqual(
      expect.arrayContaining(['Docker', 'REST APIs', 'microservices', 'Redis']),
    );

    // Score remains appropriately low — only 1 of ~16 real weighted
    // requirements (PostgreSQL) is genuinely supported; soft skills present
    // in the JD but missing from the CV must not be the reason it's low.
    expect(atsPayload.atsScore).toBeLessThan(20);

    // Recommendation output is not flooded with one card per keyword.
    const [, , updatePayload] = mockManager.update.mock.calls.find(
      ([, , payload]) => (payload as { status?: string }).status === 'done',
    ) as [unknown, string, { suggestions: Array<{ text: string }> }];
    expect(updatePayload.suggestions.length).toBeLessThanOrEqual(8);
    // No surviving suggestion is about a purely generic verb.
    for (const verb of ['developing', 'maintaining', 'designing', 'testing']) {
      expect(updatePayload.suggestions.some((s) => s.text.includes(`with ${verb},`))).toBe(false);
    }
  });

  it('marks the analysis failed and never persists suggestions when the CV has no parsed content at process time', async () => {
    mockCvService.findById.mockResolvedValue({ ...MOCK_CV, parsedContent: undefined });

    await runProcess();

    expect(mockAiService.runAnalysis).not.toHaveBeenCalled();
    expect(mockAnalysisRepo.update).toHaveBeenCalledWith('analysis-1', { status: 'failed' });
  });

  // ─── Quota-refund fix — durable usage logging ──────────────────────────────
  // BillingService counts these audit_logs records, not live analyses rows,
  // to compute monthly usage (see usage-actions.ts) — so a genuine success
  // must log exactly once, and a failure must never log at all.

  it('logs a durable usage record via AuditService on genuine success — never on failure', async () => {
    mockAnalysisRepo.findOneByOrFail.mockResolvedValue({
      id: 'analysis-1',
      userId: 'user-1',
      jobDescription: 'Looking for a backend engineer with Kubernetes experience.',
    });
    mockAiService.runAnalysis.mockResolvedValue({
      result: {
        match_score: 70,
        suggestions: [],
        ats_keywords: [],
      },
      modelUsed: 'gpt-4o',
      tokensUsed: 100,
    });

    await runProcess();

    // Reliability fix: written via logTransactional(), inside the same
    // transaction as the analysis/ATS report update above — see
    // analysis.service.ts.
    expect(mockAuditService.logTransactional).toHaveBeenCalledWith(mockManager, {
      userId: 'user-1',
      action: 'analysis.generated',
      entityType: 'analysis',
      entityId: 'analysis-1',
    });
  });

  it('never logs a usage record when the analysis fails', async () => {
    mockCvService.findById.mockResolvedValue({ ...MOCK_CV, parsedContent: undefined });

    await runProcess();

    expect(mockAuditService.logTransactional).not.toHaveBeenCalled();
    expect(mockAuditService.log).not.toHaveBeenCalled();
  });

  // Reliability fix — a "successful" analysis can never exist without its
  // usage event: if the transactional audit write fails, the whole
  // transaction (result + ATS report + audit log) rolls back together, so
  // the outer catch marks the analysis 'failed' instead of silently
  // reporting success with untracked usage.
  it('marks the analysis failed when the transactional audit write fails, rather than reporting success with untracked usage', async () => {
    mockAnalysisRepo.findOneByOrFail.mockResolvedValue({
      id: 'analysis-1',
      userId: 'user-1',
      jobDescription: 'Looking for a backend engineer with Kubernetes experience.',
    });
    mockAiService.runAnalysis.mockResolvedValue({
      result: { match_score: 70, suggestions: [], ats_keywords: [] },
      modelUsed: 'gpt-4o',
      tokensUsed: 100,
    });
    mockAuditService.logTransactional.mockRejectedValueOnce(new Error('DB unavailable'));

    await runProcess();

    expect(mockAnalysisRepo.update).toHaveBeenCalledWith('analysis-1', { status: 'failed' });
    expect(mockEventEmitter.emit).not.toHaveBeenCalledWith('analysis.completed', expect.anything());
  });
});
