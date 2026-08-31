import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';

import { HealthController } from './health.controller';

@Module({
  // Registering the existing 'cv-analysis' queue gives HealthController a
  // BullMQ-managed Redis client (queue.client) using the same REDIS_URL
  // connection config already defined in AppModule's BullModule.forRootAsync
  // — no new package, no hand-rolled ioredis client.
  imports: [BullModule.registerQueue({ name: 'cv-analysis' })],
  controllers: [HealthController],
})
export class HealthModule {}
