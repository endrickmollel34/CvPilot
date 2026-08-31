import {
  Injectable,
  Logger,
  ForbiddenException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { type Repository } from 'typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import type { Job } from 'bullmq';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { Observable } from 'rxjs';
import { fromEvent } from 'rxjs';
import { filter, map } from 'rxjs/operators';

import { AnalysisEntity } from '../../entities/analysis.entity';
import { AtsReportEntity } from '../../entities/ats-report.entity';
import { UserService } from '../user/user.service';
import { CvService } from '../cv/cv.service';
import { BillingService } from '../billing/billing.service';
import { AiService } from './ai.service';
import type { CreateAnalysisDto } from './dto/create-analysis.dto';

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
    private readonly userService: UserService,
    private readonly cvService: CvService,
    private readonly billingService: BillingService,
    private readonly aiService: AiService,
  ) {
    super();
  }

  async submit(clerkId: string, dto: CreateAnalysisDto): Promise<AnalysisEntity> {
    const user = await this.userService.findByClerkId(clerkId);

    const cv = await this.cvService.findById(dto.cvId);
    if (cv.userId !== user.id) {
      throw new ForbiddenException('CV not found');
    }
    if (cv.parseStatus !== 'done' || !cv.parsedContent) {
      throw new UnprocessableEntityException('CV is still being parsed. Please try again shortly.');
    }

    const canAnalyse = await this.billingService.canPerformAction(user.id, 'analyse');
    if (!canAnalyse) {
      throw new ForbiddenException(
        'Monthly analysis limit reached. Upgrade your plan to continue.',
      );
    }

    const analysis = this.analysisRepo.create({
      userId: user.id,
      cvId: dto.cvId,
      jobTitle: dto.jobTitle,
      companyName: dto.companyName,
      jobDescription: dto.jobDescription,
      status: 'pending',
    });
    const saved = await this.analysisRepo.save(analysis);
    await this.analysisQueue.add('run-analysis', { analysisId: saved.id, cvId: dto.cvId });
    return saved;
  }

  async process(job: Job<{ analysisId: string; cvId: string }>): Promise<void> {
    const { analysisId, cvId } = job.data;
    this.logger.log(`Running analysis ${analysisId} for CV ${cvId}`);

    await this.analysisRepo.update(analysisId, { status: 'processing' });

    try {
      const [analysis, cv] = await Promise.all([
        this.analysisRepo.findOneByOrFail({ id: analysisId }),
        this.cvService.findById(cvId),
      ]);

      if (!cv.parsedContent) {
        throw new Error(`CV ${cvId} has no parsed content`);
      }

      const { result, modelUsed, tokensUsed } = await this.aiService.runAnalysis(
        cv.parsedContent,
        analysis.jobDescription,
      );

      await this.analysisRepo.update(analysisId, {
        matchScore: result.match_score,
        suggestions: result.suggestions,
        modelUsed,
        tokensUsed,
        status: 'done',
        completedAt: new Date(),
      });

      const keywordHits = result.ats_keywords.filter((k) => k.found);
      const missingKeywords = result.ats_keywords.filter((k) => !k.found).map((k) => k.keyword);
      const atsScore =
        result.ats_keywords.length > 0
          ? Math.round((keywordHits.length / result.ats_keywords.length) * 100)
          : 0;

      await this.atsRepo.save(
        this.atsRepo.create({ analysisId, keywordHits, missingKeywords, atsScore }),
      );

      this.eventEmitter.emit('analysis.completed', { analysisId });
      this.logger.log(`Analysis ${analysisId} completed (score: ${result.match_score})`);
    } catch (err) {
      this.logger.error(`Analysis ${analysisId} failed`, err);
      await this.analysisRepo.update(analysisId, { status: 'failed' });
    }
  }

  async listForUser(clerkId: string) {
    const user = await this.userService.findByClerkId(clerkId);
    return this.analysisRepo.find({
      where: { userId: user.id },
      // 'cv' is a LEFT JOIN — resolves to undefined rather than excluding
      // the analysis if the source CV has since been (soft-)deleted.
      relations: ['atsReport', 'cv'],
      order: { createdAt: 'DESC' },
    });
  }

  async findOneForUser(clerkId: string, id: string) {
    const user = await this.userService.findByClerkId(clerkId);
    const analysis = await this.analysisRepo.findOne({
      where: { id, userId: user.id },
      relations: ['atsReport', 'cv'],
    });
    if (!analysis) throw new NotFoundException(`Analysis ${id} not found`);
    return analysis;
  }

  statusStream(analysisId: string): Observable<MessageEvent> {
    return fromEvent(this.eventEmitter, 'analysis.completed').pipe(
      filter(
        (data): data is { analysisId: string } =>
          typeof data === 'object' &&
          data !== null &&
          (data as Record<string, unknown>)['analysisId'] === analysisId,
      ),
      map((data) => ({ data }) as MessageEvent),
    );
  }
}
