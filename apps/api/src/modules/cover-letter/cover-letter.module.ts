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

@Module({
  imports: [
    TypeOrmModule.forFeature([CoverLetterEntity]),
    BullModule.registerQueue({ name: 'cover-letter' }),
    BillingModule,
    UserModule,
    CvModule,
    AnalysisModule,
  ],
  controllers: [CoverLetterController],
  providers: [CoverLetterService, CoverLetterAiService],
  exports: [CoverLetterService],
})
export class CoverLetterModule {}
