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

@Module({
  imports: [
    TypeOrmModule.forFeature([AnalysisEntity, AtsReportEntity]),
    BullModule.registerQueue({ name: 'cv-analysis' }),
    BillingModule,
    UserModule,
    CvModule,
  ],
  controllers: [AnalysisController],
  providers: [AnalysisService, AiService],
  exports: [AnalysisService],
})
export class AnalysisModule {}
