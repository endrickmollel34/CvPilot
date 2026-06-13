import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';

import { CvController } from './cv.controller';
import { CvService } from './cv.service';
import { CvEntity } from '../../entities/cv.entity';
import { BillingModule } from '../billing/billing.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([CvEntity]),
    BullModule.registerQueue({ name: 'cv-parsing' }),
    BillingModule,
  ],
  controllers: [CvController],
  providers: [CvService],
  exports: [CvService],
})
export class CvModule {}
