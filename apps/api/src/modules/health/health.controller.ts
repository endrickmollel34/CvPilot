import { Controller, Get, Logger, Res } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import type { Response } from 'express';

// Public infrastructure endpoint — no ClerkGuard, no rate limiting (the
// entire controller is exempt via @SkipThrottle since this is polled by the
// deploy pipeline and uptime monitors, not end users). Uses @Res() to
// control the response body/status precisely rather than going through
// GlobalExceptionFilter, so the shape below is guaranteed exact regardless
// of how error responses elsewhere in the app are formatted.
@Controller('health')
@SkipThrottle()
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectQueue('cv-analysis') private readonly queue: Queue,
  ) {}

  @Get()
  async check(@Res() res: Response): Promise<void> {
    const [dbOk, redisOk] = await Promise.all([this.checkDb(), this.checkRedis()]);
    const healthy = dbOk && redisOk;

    res.status(healthy ? 200 : 503).json({
      status: healthy ? 'ok' : 'error',
      db: dbOk ? 'ok' : 'error',
      redis: redisOk ? 'ok' : 'error',
      timestamp: new Date().toISOString(),
    });
  }

  private async checkDb(): Promise<boolean> {
    try {
      await this.dataSource.query('SELECT 1');
      return true;
    } catch (err) {
      // Server-side diagnostic only — never included in the response body.
      this.logger.warn(
        `Health check: database connectivity failed (${err instanceof Error ? err.message : 'unknown error'})`,
      );
      return false;
    }
  }

  private async checkRedis(): Promise<boolean> {
    try {
      const client = await this.queue.client;
      // bullmq types `queue.client` as its own minimal IRedisClient
      // interface, which omits `ping` even though the runtime value is a
      // real ioredis client — narrow cast to reach the actual command.
      await (client as unknown as { ping(): Promise<string> }).ping();
      return true;
    } catch (err) {
      this.logger.warn(
        `Health check: Redis connectivity failed (${err instanceof Error ? err.message : 'unknown error'})`,
      );
      return false;
    }
  }
}
