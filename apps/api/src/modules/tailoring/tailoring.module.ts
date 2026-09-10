import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';

import { TailoringController } from './tailoring.controller';
import { TailoringService } from './tailoring.service';
import { TailoringProcessor } from './tailoring.processor';
import { TailoringAiService } from './tailoring-ai.service';
import { TailoringEntity } from '../../entities/tailoring.entity';
import { CvModule } from '../cv/cv.module';
import { BillingModule } from '../billing/billing.module';
import { UserModule } from '../user/user.module';
import { AuditModule } from '../audit/audit.module';
import { QUEUE_JOB_RETENTION } from '../../common/constants/queue-retention';

@Module({
  imports: [
    TypeOrmModule.forFeature([TailoringEntity]),
    BullModule.registerQueue({ name: 'cv-tailoring', defaultJobOptions: QUEUE_JOB_RETENTION }),
    CvModule,
    BillingModule,
    UserModule,
    AuditModule,
  ],
  controllers: [TailoringController],
  providers: [TailoringService, TailoringProcessor, TailoringAiService],
})
export class TailoringModule {}
