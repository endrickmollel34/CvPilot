import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ParsingService } from './parsing.service';
import { CvEntity } from '../../entities/cv.entity';

@Module({
  imports: [TypeOrmModule.forFeature([CvEntity]), BullModule.registerQueue({ name: 'cv-parsing' })],
  providers: [ParsingService],
  exports: [ParsingService],
})
export class ParsingModule {}
