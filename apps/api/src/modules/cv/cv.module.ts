import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';

import { CvController } from './cv.controller';
import { CvService } from './cv.service';
import { CvEntity } from '../../entities/cv.entity';
import { BillingModule } from '../billing/billing.module';
import { UserModule } from '../user/user.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([CvEntity]),
    BullModule.registerQueue({ name: 'cv-parsing' }),
    BillingModule,
    UserModule,
  ],
  controllers: [CvController],
  providers: [CvService],
  exports: [CvService],
})
export class CvModule {}
