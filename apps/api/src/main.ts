import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';

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

  app.enableCors({
    origin: process.env['FRONTEND_URL'] ?? 'http://localhost:3000',
    credentials: true,
  });

  const port = process.env['PORT'] ?? 3001;
  await app.listen(port);
  console.log(`API running on port ${port}`);
}

bootstrap();
