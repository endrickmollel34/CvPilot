import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { type Repository } from 'typeorm';

import { AnalysisEntity } from '../../entities/analysis.entity';
import { CoverLetterEntity } from '../../entities/cover-letter.entity';
import { SubscriptionEntity } from '../../entities/subscription.entity';

@Injectable()
export class DashboardService {
  constructor(
    @InjectRepository(AnalysisEntity)
    private readonly analysisRepo: Repository<AnalysisEntity>,
    @InjectRepository(CoverLetterEntity)
    private readonly coverLetterRepo: Repository<CoverLetterEntity>,
    @InjectRepository(SubscriptionEntity)
    private readonly subscriptionRepo: Repository<SubscriptionEntity>,
  ) {}

  async getSummary(_clerkId: string) {
    // DashboardModule is read-only — queries other modules' tables but never writes them
    // TODO: resolve clerkId → userId, scope all queries by user_id
    const [analyses, coverLetters] = await Promise.all([
      this.analysisRepo.find({ order: { createdAt: 'DESC' }, take: 20 }),
      this.coverLetterRepo.find({ order: { createdAt: 'DESC' }, take: 20 }),
    ]);
    return { analyses, coverLetters };
  }
}
