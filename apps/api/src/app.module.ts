import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';

import { AuthModule } from './modules/auth/auth.module';
import { UserModule } from './modules/user/user.module';
import { CvModule } from './modules/cv/cv.module';
import { ParsingModule } from './modules/parsing/parsing.module';
import { AnalysisModule } from './modules/analysis/analysis.module';
import { CoverLetterModule } from './modules/cover-letter/cover-letter.module';
import { BillingModule } from './modules/billing/billing.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { NotificationModule } from './modules/notification/notification.module';
import { AuditModule } from './modules/audit/audit.module';
import { TailoringModule } from './modules/tailoring/tailoring.module';
import { HealthModule } from './modules/health/health.module';
import { ContactModule } from './modules/contact/contact.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),

    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        url: config.getOrThrow<string>('DATABASE_URL'),
        autoLoadEntities: true,
        // Migrations run via CLI — never synchronize in production
        synchronize: false,
        ssl: config.get('NODE_ENV') === 'production' ? { rejectUnauthorized: false } : false,
      }),
    }),

    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: { url: config.getOrThrow<string>('REDIS_URL') },
      }),
    }),

    EventEmitterModule.forRoot(),

    ThrottlerModule.forRoot([
      {
        // 100 requests per minute per IP (default guard)
        ttl: 60_000,
        limit: 100,
      },
    ]),

    AuthModule,
    UserModule,
    CvModule,
    ParsingModule,
    AnalysisModule,
    CoverLetterModule,
    BillingModule,
    DashboardModule,
    NotificationModule,
    AuditModule,
    TailoringModule,
    HealthModule,
    ContactModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
