import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { AnalysisEntity } from '../../entities/analysis.entity';
import { CoverLetterEntity } from '../../entities/cover-letter.entity';
import { SubscriptionEntity } from '../../entities/subscription.entity';

@Module({
  imports: [TypeOrmModule.forFeature([AnalysisEntity, CoverLetterEntity, SubscriptionEntity])],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
