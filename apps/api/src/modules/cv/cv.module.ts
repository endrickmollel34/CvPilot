import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';

import { CvController } from './cv.controller';
import { CvService } from './cv.service';
import { CvPhotoService } from './cv-photo.service';
import { PrefillExtractionService } from './prefill-extraction.service';
import { PrefillLockService } from './prefill-lock.service';
import { PdfGenerationService } from './pdf-generation.service';
import { CvEntity } from '../../entities/cv.entity';
import { BillingModule } from '../billing/billing.module';
import { UserModule } from '../user/user.module';
import { R2StorageService } from '../../common/services/r2-storage.service';
import { AiRateLimitModule } from '../../common/rate-limit/ai-rate-limit.module';
import { QUEUE_JOB_RETENTION } from '../../common/constants/queue-retention';

@Module({
  imports: [
    TypeOrmModule.forFeature([CvEntity]),
    BullModule.registerQueue({ name: 'cv-parsing', defaultJobOptions: QUEUE_JOB_RETENTION }),
    BillingModule,
    UserModule,
    AiRateLimitModule,
  ],
  controllers: [CvController],
  providers: [
    CvService,
    CvPhotoService,
    PrefillExtractionService,
    PrefillLockService,
    PdfGenerationService,
    R2StorageService,
  ],
  exports: [CvService],
})
export class CvModule {}
