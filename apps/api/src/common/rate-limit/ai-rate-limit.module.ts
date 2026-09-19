import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';

import { AiRateLimitGuard } from './ai-rate-limit.guard';
import { AiRateLimitService } from './ai-rate-limit.service';
import {
  AI_RATE_LIMIT_MAX_REQUESTS,
  AI_RATE_LIMIT_OPTIONS,
  AI_RATE_LIMIT_WINDOW_MS,
} from './ai-rate-limit.constants';
import { QUEUE_JOB_RETENTION } from '../constants/queue-retention';

/**
 * Imported by every module whose controller has a route guarded by
 * AiRateLimitGuard (AnalysisModule, CoverLetterModule, TailoringModule,
 * CvModule) — Nest resolves `@UseGuards(AiRateLimitGuard)` against the
 * importing module's own providers, so each of those modules needs this
 * in its own `imports`, same as any other shared provider module.
 *
 * Registers the 'cv-analysis' BullMQ queue purely to obtain a Redis client
 * (see AiRateLimitService's own doc comment) — the exact same convention
 * HealthModule already uses for the same reason, deliberately reusing an
 * existing queue registration rather than adding a new Redis connection
 * or a queue that never actually processes jobs. Every module that
 * imports this one already separately registers its OWN queue for real
 * job processing (e.g. CoverLetterModule ⟶ 'cover-letter'); registering
 * 'cv-analysis' here too is additional and harmless, following the same
 * pattern HealthModule already established.
 */
@Module({
  imports: [
    BullModule.registerQueue({ name: 'cv-analysis', defaultJobOptions: QUEUE_JOB_RETENTION }),
  ],
  providers: [
    AiRateLimitService,
    AiRateLimitGuard,
    {
      provide: AI_RATE_LIMIT_OPTIONS,
      useValue: { limit: AI_RATE_LIMIT_MAX_REQUESTS, windowMs: AI_RATE_LIMIT_WINDOW_MS },
    },
  ],
  // AI_RATE_LIMIT_OPTIONS must be exported too, not just the two classes:
  // Nest instantiates a guard referenced via a controller's `@UseGuards()`
  // using the injector of the module that owns the CONTROLLER (e.g.
  // CvModule), not this module's own — so every one of AiRateLimitGuard's
  // constructor dependencies has to be resolvable from THAT importing
  // module's visibility, which means exported from here. Confirmed by
  // reproducing the failure directly: booting the real AppModule without
  // this export throws "Nest can't resolve dependencies of the
  // AiRateLimitGuard (AiRateLimitService, ?)... in the CvModule context."
  exports: [AiRateLimitService, AiRateLimitGuard, AI_RATE_LIMIT_OPTIONS],
})
export class AiRateLimitModule {}
