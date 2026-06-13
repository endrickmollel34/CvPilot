import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { type Repository } from 'typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Queue, Job } from 'bullmq';
import type { EventEmitter2 } from '@nestjs/event-emitter';
import type { Observable } from 'rxjs';
import { fromEvent } from 'rxjs';
import { map } from 'rxjs/operators';
import { z } from 'zod';

import { AnalysisEntity } from '../../entities/analysis.entity';
import { AtsReportEntity } from '../../entities/ats-report.entity';

const AnalysisResponseSchema = z.object({
  match_score: z.number().min(0).max(100),
  suggestions: z
    .array(
      z.object({
        category: z.enum(['MISSING_KEYWORD', 'WEAK_LANGUAGE', 'STRUCTURE', 'ATS_WARNING']),
        priority: z.enum(['HIGH', 'MEDIUM', 'LOW']),
        text: z.string().min(10).max(500),
      }),
    )
    .min(3)
    .max(20),
  ats_keywords: z.array(z.object({ keyword: z.string(), found: z.boolean() })),
});

@Processor('cv-analysis')
@Injectable()
export class AnalysisService extends WorkerHost {
  private readonly logger = new Logger(AnalysisService.name);

  constructor(
    @InjectRepository(AnalysisEntity)
    private readonly analysisRepo: Repository<AnalysisEntity>,
    @InjectRepository(AtsReportEntity)
    private readonly atsRepo: Repository<AtsReportEntity>,
    @InjectQueue('cv-analysis')
    private readonly analysisQueue: Queue,
    private readonly eventEmitter: EventEmitter2,
  ) {
    super();
  }

  async createAnalysis(
    clerkId: string,
    body: { cvId: string; jobTitle: string; companyName: string; jobDescription: string },
  ) {
    // TODO: resolve clerkId → userId, check subscription limit via BillingService
    const analysis = this.analysisRepo.create({
      jobTitle: body.jobTitle,
      companyName: body.companyName,
      jobDescription: body.jobDescription,
      status: 'pending',
    });
    const saved = await this.analysisRepo.save(analysis);
    await this.analysisQueue.add('run-analysis', { analysisId: saved.id, cvId: body.cvId });
    return saved;
  }

  async process(job: Job<{ analysisId: string; cvId: string }>): Promise<void> {
    const { analysisId, cvId } = job.data;
    this.logger.log(`Running analysis ${analysisId} for CV ${cvId}`);

    await this.analysisRepo.update(analysisId, { status: 'processing' });

    try {
      // TODO: fetch parsedContent from cvs table
      // TODO: call AIService.analyse(cvText, jdText) with GPT-4o
      // TODO: validate response with AnalysisResponseSchema (retry up to 3x)
      const mockResult = { match_score: 0, suggestions: [], ats_keywords: [] };
      const parsed = AnalysisResponseSchema.parse(mockResult);

      await this.analysisRepo.update(analysisId, {
        matchScore: parsed.match_score,
        suggestions: parsed.suggestions,
        status: 'done',
        completedAt: new Date(),
      });

      this.eventEmitter.emit('analysis.completed', { analysisId });
    } catch (err) {
      this.logger.error(`Analysis ${analysisId} failed`, err);
      await this.analysisRepo.update(analysisId, { status: 'failed' });
    }
  }

  async listForUser(_clerkId: string) {
    // TODO: enforce user_id scoping
    return this.analysisRepo.find({ order: { createdAt: 'DESC' } });
  }

  async findOneForUser(_clerkId: string, id: string) {
    return this.analysisRepo.findOneByOrFail({ id });
  }

  statusStream(_analysisId: string): Observable<MessageEvent> {
    return fromEvent(this.eventEmitter, 'analysis.completed').pipe(
      map((data) => ({ data }) as MessageEvent),
    );
  }
}
