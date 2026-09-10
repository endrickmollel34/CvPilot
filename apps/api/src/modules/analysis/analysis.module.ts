import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';

import { AnalysisController } from './analysis.controller';
import { AnalysisService } from './analysis.service';
import { AiService } from './ai.service';
import { AnalysisEntity } from '../../entities/analysis.entity';
import { AtsReportEntity } from '../../entities/ats-report.entity';
import { BillingModule } from '../billing/billing.module';
import { UserModule } from '../user/user.module';
import { CvModule } from '../cv/cv.module';
import { AuditModule } from '../audit/audit.module';
import { QUEUE_JOB_RETENTION } from '../../common/constants/queue-retention';

@Module({
  imports: [
    TypeOrmModule.forFeature([AnalysisEntity, AtsReportEntity]),
    BullModule.registerQueue({ name: 'cv-analysis', defaultJobOptions: QUEUE_JOB_RETENTION }),
    BillingModule,
    UserModule,
    CvModule,
    AuditModule,
  ],
  controllers: [AnalysisController],
  providers: [AnalysisService, AiService],
  exports: [AnalysisService],
})
export class AnalysisModule {}
