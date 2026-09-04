import { randomUUID } from 'crypto';

import { Test, type TestingModule } from '@nestjs/testing';
import { TypeOrmModule, getRepositoryToken } from '@nestjs/typeorm';
import { getQueueToken } from '@nestjs/bullmq';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ConfigService } from '@nestjs/config';
import { UnprocessableEntityException, ForbiddenException } from '@nestjs/common';
import type { Repository } from 'typeorm';
import type { Job } from 'bullmq';

import type { CvContent } from '@cvpilot/shared';
import { UserEntity } from '../src/entities/user.entity';
import { ProfileEntity } from '../src/entities/profile.entity';
import { CvEntity } from '../src/entities/cv.entity';
import { AnalysisEntity } from '../src/entities/analysis.entity';
import { AtsReportEntity } from '../src/entities/ats-report.entity';
import { CoverLetterEntity } from '../src/entities/cover-letter.entity';
import { SubscriptionEntity } from '../src/entities/subscription.entity';
import { PaymentEntity } from '../src/entities/payment.entity';
import { AuditLogEntity } from '../src/entities/audit-log.entity';
import { NotificationEntity } from '../src/entities/notification.entity';
import { TailoringEntity } from '../src/entities/tailoring.entity';
import { CvService } from '../src/modules/cv/cv.service';
import {
  CoverLetterService,
  type CoverLetterJobData,
} from '../src/modules/cover-letter/cover-letter.service';
import { CoverLetterAiService } from '../src/modules/cover-letter/cover-letter-ai.service';
import { UserService } from '../src/modules/user/user.service';
import { BillingService } from '../src/modules/billing/billing.service';
import { AnalysisService } from '../src/modules/analysis/analysis.service';
import { PrefillExtractionService } from '../src/modules/cv/prefill-extraction.service';
import { PdfGenerationService } from '../src/modules/cv/pdf-generation.service';

/**
 * Real-Postgres regression coverage for the "CV is still being parsed"
 * cover-letter bug (cover-letter.service.ts + cv-text-resolver.util.ts).
 *
 * Unlike cover-letter.service.spec.ts (which mocks CvService/its repository
 * entirely), this exercises the REAL CvService.findById against REAL rows
 * round-tripped through Postgres via TypeORM — the exact same shapes
 * CvService.createBuilder/prefillFromUpload/createTailored/confirmUpload
 * actually persist. Only genuine external boundaries are stubbed: the AI
 * provider (no real OpenAI/Anthropic spend), billing (no Stripe/subscription
 * fixture needed), the BullMQ queue/R2 client (never reached by the code
 * under test), and AnalysisService (unused — no dto.analysisId in these
 * cases).
 *
 * Requires local Postgres reachable at the URL below (`docker compose up -d`
 * from the repo root) with migrations applied (`npm run migration:run`).
 */

const DB_URL = 'postgresql://cvpilot:cvpilot@localhost:5432/cvpilot';

const dummyConfig = {
  getOrThrow: jest.fn((key: string) => {
    const vals: Record<string, string> = {
      CLOUDFLARE_R2_ENDPOINT: 'https://r2.example.com',
      CLOUDFLARE_R2_ACCESS_KEY_ID: 'key',
      CLOUDFLARE_R2_SECRET_ACCESS_KEY: 'secret',
      CLOUDFLARE_R2_BUCKET_NAME: 'bucket',
    };
    return vals[key] ?? 'dummy';
  }),
  get: jest.fn(),
} as unknown as ConfigService;

const REALISTIC_STRUCTURED_CONTENT: CvContent = {
  version: 1,
  personalDetails: {
    fullName: 'Amara Okafor',
    email: 'amara.okafor@example.com',
    phone: '+44 7700 900123',
    location: 'Manchester, UK',
    jobTitle: 'Backend Engineer',
  },
  summary:
    'Backend engineer with three years of experience building payment and checkout systems in Node.js and PostgreSQL.',
  workExperience: [
    {
      id: 'we-1',
      company: 'Northbridge Retail',
      title: 'Backend Engineer',
      location: 'Manchester, UK',
      startDate: '2022-03',
      current: true,
      bullets: [
        'Built and maintained RESTful checkout APIs handling 40k orders/day',
        'Migrated the order service from MongoDB to PostgreSQL, cutting query latency by 60%',
      ],
    },
  ],
  education: [
    {
      id: 'ed-1',
      institution: 'University of Manchester',
      degree: 'BSc',
      field: 'Computer Science',
      startDate: '2018-09',
      endDate: '2021-06',
    },
  ],
  skills: [
    { id: 'sk-1', name: 'TypeScript' },
    { id: 'sk-2', name: 'PostgreSQL' },
  ],
  languages: [],
  certifications: [],
  sectionOrder: ['summary', 'workExperience', 'education', 'skills', 'languages', 'certifications'],
};

describe('Cover letter generation against real Postgres-backed CV rows (e2e)', () => {
  let moduleRef: TestingModule;
  let cvRepo: Repository<CvEntity>;
  let userRepo: Repository<UserEntity>;
  let coverLetterRepo: Repository<CoverLetterEntity>;
  let coverLetterService: CoverLetterService;
  let mockAiService: { generateCoverLetter: jest.Mock };
  let testUser: UserEntity;

  // CoverLetterService/CvService both resolve the acting user via
  // UserService.findByClerkId() — stubbed (real Clerk verification is out of
  // scope here) rather than left unset, and pointed at the real inserted
  // user row once it exists below, so submit()'s ownership check and repo
  // writes use a real users.id foreign key.
  const mockUserService = { findByClerkId: jest.fn() };

  const createdCvIds: string[] = [];
  const createdLetterIds: string[] = [];

  // The default 5s Jest hook timeout is too tight for the first real
  // TypeORM/pg connection in this process — bump it (30s) rather than
  // letting the connection attempt straggle past a torn-down Jest
  // environment (that produces a confusing "this.postgres.Pool is not a
  // constructor" error, not a real driver bug).
  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        // The full entity set (matching data-source.ts) is required even
        // though only User/Cv/CoverLetter are used directly below — several
        // entities reference each other by string in @ManyToOne/@OneToMany
        // decorators (e.g. UserEntity -> ProfileEntity), and TypeORM fails
        // metadata resolution for the whole graph if any referenced entity
        // is missing from this list.
        TypeOrmModule.forRoot({
          type: 'postgres',
          url: DB_URL,
          entities: [
            UserEntity,
            ProfileEntity,
            CvEntity,
            AnalysisEntity,
            AtsReportEntity,
            CoverLetterEntity,
            SubscriptionEntity,
            PaymentEntity,
            AuditLogEntity,
            NotificationEntity,
            TailoringEntity,
          ],
          synchronize: false,
        }),
        TypeOrmModule.forFeature([UserEntity, CvEntity, CoverLetterEntity]),
      ],
      providers: [
        CvService,
        CoverLetterService,
        { provide: ConfigService, useValue: dummyConfig },
        { provide: getQueueToken('cv-parsing'), useValue: { add: jest.fn() } },
        { provide: getQueueToken('cover-letter'), useValue: { add: jest.fn() } },
        { provide: EventEmitter2, useValue: { emit: jest.fn(), on: jest.fn() } },
        { provide: UserService, useValue: mockUserService },
        {
          provide: BillingService,
          useValue: { canPerformAction: jest.fn().mockResolvedValue(true) },
        },
        { provide: AnalysisService, useValue: { findOneForUser: jest.fn() } },
        { provide: PrefillExtractionService, useValue: {} },
        { provide: PdfGenerationService, useValue: {} },
        { provide: CoverLetterAiService, useValue: { generateCoverLetter: jest.fn() } },
      ],
    }).compile();

    cvRepo = moduleRef.get(getRepositoryToken(CvEntity));
    userRepo = moduleRef.get(getRepositoryToken(UserEntity));
    coverLetterRepo = moduleRef.get(getRepositoryToken(CoverLetterEntity));
    coverLetterService = moduleRef.get(CoverLetterService);
    mockAiService = moduleRef.get(CoverLetterAiService) as unknown as typeof mockAiService;

    // Real user row — cover_letters.user_id / cvs.user_id are real columns.
    testUser = await userRepo.save(
      userRepo.create({
        clerkId: `clerk-e2e-${randomUUID()}`,
        email: `e2e-${randomUUID()}@example.com`,
      }),
    );
    mockUserService.findByClerkId.mockResolvedValue(testUser);
  }, 30000);

  afterAll(async () => {
    if (createdLetterIds.length) await coverLetterRepo.delete(createdLetterIds);
    if (createdCvIds.length) await cvRepo.delete(createdCvIds);
    await userRepo.delete(testUser.id);
    await moduleRef.close();
  });

  beforeEach(() => {
    mockAiService.generateCoverLetter.mockReset();
  });

  async function insertCv(overrides: Partial<CvEntity>): Promise<CvEntity> {
    const saved = await cvRepo.save(
      cvRepo.create({
        userId: testUser.id,
        isActive: true,
        ...overrides,
      }),
    );
    createdCvIds.push(saved.id);
    return saved;
  }

  // ─── A. Structured CV path (the reported bug) ─────────────────────────────

  it('A1: submit() no longer rejects a real prefilled CV row (parseStatus=done, parsedContent=null, real structured content) with "still being parsed"', async () => {
    const cv = await insertCv({
      source: 'prefill',
      parseStatus: 'done',
      parsedContent: undefined,
      content: REALISTIC_STRUCTURED_CONTENT,
    });

    const letter = await coverLetterService.submit(testUser.clerkId, {
      cvId: cv.id,
      jobTitle: 'Senior Backend Engineer',
      companyName: 'Acme Corp',
      jobDescription: 'We need a backend engineer experienced with PostgreSQL and TypeScript.',
    });
    createdLetterIds.push(letter.id);

    expect(letter.status).toBe('queued');

    // Confirm what's actually in Postgres, not just the returned object.
    const persisted = await cvRepo.findOneByOrFail({ id: cv.id });
    expect(persisted.parsedContent).toBeFalsy();
    expect(persisted.content).toBeTruthy();
  });

  it('A2: process() generates successfully from the real structured content, and that content is what grounds the AI request', async () => {
    const cv = await insertCv({
      source: 'builder',
      parseStatus: 'done',
      parsedContent: undefined,
      content: REALISTIC_STRUCTURED_CONTENT,
    });
    const letter = await coverLetterRepo.save(
      coverLetterRepo.create({
        userId: testUser.id,
        cvId: cv.id,
        jobTitle: 'Senior Backend Engineer',
        companyName: 'Acme Corp',
        content: '',
        status: 'queued',
      }),
    );
    createdLetterIds.push(letter.id);

    mockAiService.generateCoverLetter.mockResolvedValue({
      content: 'A generated cover letter body.',
      modelUsed: 'gpt-4o',
      tokensUsed: 250,
    });

    await coverLetterService.process({
      data: {
        coverLetterId: letter.id,
        userId: testUser.id,
        cvId: cv.id,
        jobTitle: 'Senior Backend Engineer',
        companyName: 'Acme Corp',
        jobDescription: 'We need a backend engineer experienced with PostgreSQL and TypeScript.',
        tone: 'professional',
      },
    } as unknown as Job<CoverLetterJobData>);

    // The AI was actually invoked (generation "completed successfully").
    expect(mockAiService.generateCoverLetter).toHaveBeenCalledTimes(1);

    // Ground truth: the cvText argument is the SERIALIZED STRUCTURED
    // CONTENT read back from Postgres — not a hand-built string, not
    // undefined, and not the (nonexistent) parsedContent.
    const [cvTextArg] = mockAiService.generateCoverLetter.mock.calls[0] as [string];
    expect(cvTextArg).toContain('Amara Okafor');
    expect(cvTextArg).toContain('Northbridge Retail');
    expect(cvTextArg).toContain('PostgreSQL');

    const persistedLetter = await coverLetterRepo.findOneByOrFail({ id: letter.id });
    expect(persistedLetter.status).toBe('generated');
    expect(persistedLetter.content).toBe('A generated cover letter body.');
  });

  // ─── B. Uploaded CV path (must still work) ────────────────────────────────

  it('B1: submit() + process() still succeed for a real uploaded CV row (parsedContent set, content null)', async () => {
    const cv = await insertCv({
      source: 'upload',
      parseStatus: 'done',
      parsedContent:
        'Amara Okafor. Backend Engineer with three years of experience in TypeScript and PostgreSQL. ' +
        'Built checkout APIs at Northbridge Retail.',
      content: undefined,
      fileName: 'amara-cv.pdf',
      mimeType: 'application/pdf',
    });

    const letter = await coverLetterService.submit(testUser.clerkId, {
      cvId: cv.id,
      jobTitle: 'Backend Engineer',
      companyName: 'Acme Corp',
      jobDescription: 'Looking for a backend engineer.',
    });
    createdLetterIds.push(letter.id);
    expect(letter.status).toBe('queued');

    mockAiService.generateCoverLetter.mockResolvedValue({
      content: 'A generated cover letter body for the uploaded CV.',
      modelUsed: 'gpt-4o',
      tokensUsed: 200,
    });

    await coverLetterService.process({
      data: {
        coverLetterId: letter.id,
        userId: testUser.id,
        cvId: cv.id,
        jobTitle: 'Backend Engineer',
        companyName: 'Acme Corp',
        jobDescription: 'Looking for a backend engineer.',
        tone: 'professional',
      },
    } as unknown as Job<CoverLetterJobData>);

    const [cvTextArg] = mockAiService.generateCoverLetter.mock.calls[0] as [string];
    expect(cvTextArg).toContain('Northbridge Retail');

    const persistedLetter = await coverLetterRepo.findOneByOrFail({ id: letter.id });
    expect(persistedLetter.status).toBe('generated');
  });

  // ─── C. Genuinely unparsed / no-usable-content path (must still be rejected) ──

  it('C1: submit() still rejects a real CV row that is genuinely still parsing (no parsedContent, no content)', async () => {
    const cv = await insertCv({
      source: 'upload',
      parseStatus: 'processing',
      parsedContent: undefined,
      content: undefined,
      fileName: 'still-parsing.pdf',
    });

    await expect(
      coverLetterService.submit(testUser.clerkId, {
        cvId: cv.id,
        jobTitle: 'Backend Engineer',
        companyName: 'Acme Corp',
        jobDescription: 'Looking for a backend engineer.',
      }),
    ).rejects.toThrow(UnprocessableEntityException);

    expect(mockAiService.generateCoverLetter).not.toHaveBeenCalled();
  });

  it('C2: submit() still rejects a real freshly-created builder CV row with no content filled in yet', async () => {
    const cv = await insertCv({
      source: 'builder',
      parseStatus: 'done', // set immediately by createBuilder(), before any content exists
      parsedContent: undefined,
      content: undefined,
    });

    await expect(
      coverLetterService.submit(testUser.clerkId, {
        cvId: cv.id,
        jobTitle: 'Backend Engineer',
        companyName: 'Acme Corp',
        jobDescription: 'Looking for a backend engineer.',
      }),
    ).rejects.toThrow(UnprocessableEntityException);
  });

  it('C3: does not leak across users — a CV belonging to someone else is rejected before the parsing check even runs', async () => {
    const otherUser = await userRepo.save(
      userRepo.create({
        clerkId: `clerk-e2e-other-${randomUUID()}`,
        email: `e2e-other-${randomUUID()}@example.com`,
      }),
    );
    const cv = await cvRepo.save(
      cvRepo.create({
        userId: otherUser.id,
        isActive: true,
        source: 'builder',
        parseStatus: 'done',
        content: REALISTIC_STRUCTURED_CONTENT,
      }),
    );
    createdCvIds.push(cv.id);

    await expect(
      coverLetterService.submit(testUser.clerkId, {
        cvId: cv.id,
        jobTitle: 'Backend Engineer',
        companyName: 'Acme Corp',
        jobDescription: 'Looking for a backend engineer.',
      }),
    ).rejects.toThrow(ForbiddenException);

    await userRepo.delete(otherUser.id);
  });
});
