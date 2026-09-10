import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';

import { CoverLetterController } from './cover-letter.controller';
import { CoverLetterService } from './cover-letter.service';
import { CoverLetterAiService } from './cover-letter-ai.service';
import { CoverLetterEntity } from '../../entities/cover-letter.entity';
import { BillingModule } from '../billing/billing.module';
import { UserModule } from '../user/user.module';
import { CvModule } from '../cv/cv.module';
import { AnalysisModule } from '../analysis/analysis.module';
import { AuditModule } from '../audit/audit.module';
import { R2StorageService } from '../../common/services/r2-storage.service';
import { QUEUE_JOB_RETENTION } from '../../common/constants/queue-retention';

@Module({
  imports: [
    TypeOrmModule.forFeature([CoverLetterEntity]),
    BullModule.registerQueue({ name: 'cover-letter', defaultJobOptions: QUEUE_JOB_RETENTION }),
    BillingModule,
    UserModule,
    CvModule,
    AnalysisModule,
    AuditModule,
  ],
  controllers: [CoverLetterController],
  providers: [CoverLetterService, CoverLetterAiService, R2StorageService],
  exports: [CoverLetterService],
})
export class CoverLetterModule {}
