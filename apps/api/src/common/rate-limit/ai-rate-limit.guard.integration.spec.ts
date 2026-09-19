import { Test, type TestingModule } from '@nestjs/testing';
import { type ExecutionContext, type INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import request from 'supertest';

import { AnalysisController } from '../../modules/analysis/analysis.controller';
import { AnalysisService } from '../../modules/analysis/analysis.service';
import { ClerkGuard } from '../../modules/auth/guards/clerk.guard';
import { AiRateLimitGuard } from './ai-rate-limit.guard';
import { AiRateLimitService } from './ai-rate-limit.service';
import { AI_RATE_LIMIT_OPTIONS } from './ai-rate-limit.constants';
import { QUEUE_JOB_RETENTION } from '../constants/queue-retention';

/**
 * The one HTTP-level test in this bundle: proves, through a real request
 * pipeline (real ClerkGuard-shaped auth context, real AiRateLimitGuard,
 * real local Redis), that a REJECTED request never reaches the route
 * handler at all — which is what "never reaches an AI provider or
 * consumes plan usage" actually reduces to, since both of those live
 * entirely inside AnalysisService.submit() (BillingService.canPerformAction
 * + the BullMQ enqueue that eventually calls OpenAI/Anthropic). Rather
 * than reproduce this full harness once per controller, AnalysisController
 * stands in as the representative case for the underlying mechanism (a
 * per-route CanActivate guard, which Nest itself guarantees runs before
 * the handler — this isn't something that behaves differently per
 * controller); ai-rate-limit.wiring.spec.ts separately confirms the SAME
 * guard class is actually attached to the other four routes.
 *
 * Builds its own module directly from AiRateLimitService/AiRateLimitGuard
 * (the same classes AiRateLimitModule wires up in production), rather than
 * importing AiRateLimitModule itself — Nest's `overrideProvider` on a
 * token that lives inside a nested, imported module was found (during
 * this exact test's development) to be unreliable in this repo's
 * @nestjs/testing version ("Nest can't resolve dependencies of
 * AiRateLimitGuard... AI_RATE_LIMIT_OPTIONS"), so the small provider list
 * below is declared directly on this ad-hoc test module instead — same
 * real classes, same real Redis, just without a nested module boundary
 * for `overrideProvider` to trip over.
 *
 * ClerkGuard itself is overridden with a trivial stub — this suite is
 * about AiRateLimitGuard, not Clerk token verification (already covered
 * elsewhere) — but the stub still exercises the exact same "guard sets
 * request.user, a LATER guard reads it" mechanism AiRateLimitGuard
 * actually depends on in production.
 */
describe('AiRateLimitGuard (HTTP integration, real Redis)', () => {
  const TEST_CLERK_ID = `test-clerk-user-${Date.now()}`;
  const validBody = {
    cvId: '7c772fe3-2445-4240-98b4-c2fa883d40c0',
    jobTitle: 'Software Engineer',
    jobDescription: 'Build things.',
  };

  const stubClerkGuard = {
    canActivate: (context: ExecutionContext) => {
      const req = context.switchToHttp().getRequest();
      req.user = { clerkId: TEST_CLERK_ID };
      return true;
    },
  };

  async function buildApp(rateLimitOptions: { limit: number; windowMs: number }): Promise<{
    app: INestApplication;
    moduleRef: TestingModule;
    submitMock: jest.Mock;
  }> {
    const submitMock = jest.fn().mockResolvedValue({ id: 'analysis-1', status: 'pending' });

    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        BullModule.forRootAsync({
          inject: [ConfigService],
          useFactory: (config: ConfigService) => ({
            connection: { url: config.getOrThrow<string>('REDIS_URL') },
          }),
        }),
        BullModule.registerQueue({ name: 'cv-analysis', defaultJobOptions: QUEUE_JOB_RETENTION }),
      ],
      controllers: [AnalysisController],
      providers: [
        { provide: AnalysisService, useValue: { submit: submitMock } },
        AiRateLimitService,
        AiRateLimitGuard,
        { provide: AI_RATE_LIMIT_OPTIONS, useValue: rateLimitOptions },
      ],
    })
      .overrideGuard(ClerkGuard)
      .useValue(stubClerkGuard)
      .compile();

    const app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();

    return { app, moduleRef, submitMock };
  }

  it('lets `limit` requests through to the real handler, then rejects the next with 429 and never calls the handler again', async () => {
    const { app, moduleRef, submitMock } = await buildApp({ limit: 3, windowMs: 5000 });
    try {
      const server = app.getHttpServer();

      const r1 = await request(server).post('/analyses').send(validBody);
      const r2 = await request(server).post('/analyses').send(validBody);
      const r3 = await request(server).post('/analyses').send(validBody);
      expect([r1.status, r2.status, r3.status]).toEqual([201, 201, 201]);
      expect(submitMock).toHaveBeenCalledTimes(3);

      const r4 = await request(server).post('/analyses').send(validBody);
      expect(r4.status).toBe(429);
      expect(r4.headers['retry-after']).toBeDefined();
      expect(typeof r4.body.message).toBe('string');
      expect(r4.body.message).toContain('AI requests');
      // The exact proof requested: the 4th, rejected call must NOT have
      // reached AnalysisService.submit — that's where the AI job gets
      // enqueued and where plan-usage quota is checked — so the call
      // count must still read exactly 3, not 4.
      expect(submitMock).toHaveBeenCalledTimes(3);

      const r5 = await request(server).post('/analyses').send(validBody);
      expect(r5.status).toBe(429);
      expect(submitMock).toHaveBeenCalledTimes(3);
    } finally {
      await app.close();
      await moduleRef.close();
    }
  });

  it('returns 503 and never calls the handler when the rate limit service itself fails (Redis unavailable)', async () => {
    const submitMock = jest.fn().mockResolvedValue({ id: 'analysis-1', status: 'pending' });

    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        BullModule.forRootAsync({
          inject: [ConfigService],
          useFactory: (config: ConfigService) => ({
            connection: { url: config.getOrThrow<string>('REDIS_URL') },
          }),
        }),
        BullModule.registerQueue({ name: 'cv-analysis', defaultJobOptions: QUEUE_JOB_RETENTION }),
      ],
      controllers: [AnalysisController],
      providers: [
        { provide: AnalysisService, useValue: { submit: submitMock } },
        {
          provide: AiRateLimitService,
          useValue: {
            checkAndRecord: jest.fn().mockRejectedValue(new Error('connect ECONNREFUSED')),
          },
        },
        AiRateLimitGuard,
        { provide: AI_RATE_LIMIT_OPTIONS, useValue: { limit: 5, windowMs: 600_000 } },
      ],
    })
      .overrideGuard(ClerkGuard)
      .useValue(stubClerkGuard)
      .compile();

    const app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();

    try {
      const res = await request(app.getHttpServer()).post('/analyses').send(validBody);
      expect(res.status).toBe(503);
      expect(submitMock).not.toHaveBeenCalled();
    } finally {
      await app.close();
      await moduleRef.close();
    }
  });
});
