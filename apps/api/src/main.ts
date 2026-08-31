import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import type { Response } from 'express';

import { AppModule } from './app.module';
import { GlobalExceptionFilter } from './common/filters/http-exception.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { rawBody: true });

  // Lets Nest run TypeORM's/BullMQ's onModuleDestroy hooks on SIGTERM/SIGINT
  // (e.g. a Railway redeploy), instead of the process being killed mid
  // request/job with connections left open.
  app.enableShutdownHooks();

  app.setGlobalPrefix('api');

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.useGlobalFilters(new GlobalExceptionFilter());

  // Minimal, framework-native security headers — no helmet dependency for
  // three lines. Deliberately not a CSP: Clerk/Stripe make a strict one
  // fragile to get right for an MVP, and that's explicitly deferred.
  app.use((_req: unknown, res: Response, next: () => void) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    if (process.env['NODE_ENV'] === 'production') {
      // Railway/Vercel terminate TLS in front of this process — safe to
      // assert HSTS unconditionally once actually in production. Browsers
      // ignore this header entirely over a plain HTTP connection (per
      // spec), so it's harmless in local development regardless.
      res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
    }
    next();
  });

  app.enableCors({
    origin: process.env['FRONTEND_URL'] ?? 'http://localhost:3000',
    credentials: true,
  });

  const port = process.env['PORT'] ?? 3001;
  await app.listen(port);
  console.log(`API running on port ${port}`);
}

bootstrap();
