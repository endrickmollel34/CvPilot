import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';

import { HealthController } from './health.controller';
import { QUEUE_JOB_RETENTION } from '../../common/constants/queue-retention';

@Module({
  // Registering the existing 'cv-analysis' queue gives HealthController a
  // BullMQ-managed Redis client (queue.client) using the same REDIS_URL
  // connection config already defined in AppModule's BullModule.forRootAsync
  // — no new package, no hand-rolled ioredis client. defaultJobOptions kept
  // identical to AnalysisModule's own registerQueue('cv-analysis') so
  // retention is consistent regardless of which module's registration
  // NestJS resolves first.
  imports: [
    BullModule.registerQueue({ name: 'cv-analysis', defaultJobOptions: QUEUE_JOB_RETENTION }),
  ],
  controllers: [HealthController],
})
export class HealthModule {}
