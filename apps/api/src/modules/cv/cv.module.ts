import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';

import { CvController } from './cv.controller';
import { CvService } from './cv.service';
import { PrefillExtractionService } from './prefill-extraction.service';
import { PdfGenerationService } from './pdf-generation.service';
import { CvEntity } from '../../entities/cv.entity';
import { BillingModule } from '../billing/billing.module';
import { UserModule } from '../user/user.module';
import { R2StorageService } from '../../common/services/r2-storage.service';
import { QUEUE_JOB_RETENTION } from '../../common/constants/queue-retention';

@Module({
  imports: [
    TypeOrmModule.forFeature([CvEntity]),
    BullModule.registerQueue({ name: 'cv-parsing', defaultJobOptions: QUEUE_JOB_RETENTION }),
    BillingModule,
    UserModule,
  ],
  controllers: [CvController],
  providers: [CvService, PrefillExtractionService, PdfGenerationService, R2StorageService],
  exports: [CvService],
})
export class CvModule {}
