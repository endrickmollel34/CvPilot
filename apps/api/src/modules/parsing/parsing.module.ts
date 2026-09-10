import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ParsingService } from './parsing.service';
import { CvEntity } from '../../entities/cv.entity';
import { QUEUE_JOB_RETENTION } from '../../common/constants/queue-retention';

@Module({
  imports: [
    TypeOrmModule.forFeature([CvEntity]),
    // Same queue name as CvModule's own registerQueue('cv-parsing') — kept
    // in sync with identical defaultJobOptions so retention is consistent
    // regardless of which module's registration NestJS resolves first.
    BullModule.registerQueue({ name: 'cv-parsing', defaultJobOptions: QUEUE_JOB_RETENTION }),
  ],
  providers: [ParsingService],
  exports: [ParsingService],
})
export class ParsingModule {}
