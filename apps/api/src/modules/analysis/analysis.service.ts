import {
  Injectable,
  Logger,
  ForbiddenException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { type Repository, type DataSource } from 'typeorm';
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
import { AuditService } from '../audit/audit.service';
import { USAGE_ACTIONS } from '../../common/constants/usage-actions';
import { AiService } from './ai.service';
import { groundSuggestions } from './recommendation-grounding.util';
import { classifyAndVerifyKeywords, computeAtsScore } from './ats-keyword.util';
import type { CreateAnalysisDto } from './dto/create-analysis.dto';

@Processor('cv-analysis')
@Injectable()
export class AnalysisService extends WorkerHost {
  private readonly logger = new Logger(AnalysisService.name);

  constructor(
    @InjectRepository(AnalysisEntity)
    private readonly analysisRepo: Repository<AnalysisEntity>,
    @InjectQueue('cv-analysis')
    private readonly analysisQueue: Queue,
    private readonly eventEmitter: EventEmitter2,
    private readonly userService: UserService,
    private readonly cvService: CvService,
    private readonly billingService: BillingService,
    private readonly auditService: AuditService,
    private readonly aiService: AiService,
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {
    super();
  }

  async submit(clerkId: string, dto: CreateAnalysisDto): Promise<AnalysisEntity> {
    const user = await this.userService.findByClerkId(clerkId);

    const cv = await this.cvService.findById(dto.cvId);
    if (cv.userId !== user.id) {
      throw new ForbiddenException('CV not found');
    }
    // Analysis is intentionally scoped to uploaded, parsed CVs — unlike
    // Cover Letter, it does not (yet) accept structured-only content from
    // builder/prefill/tailored CVs. The frontend already only ever offers
    // uploaded CVs for analysis and points users at Job Tailoring for the
    // others (see AnalysisWorkspace.tsx), so this case is not reachable
    // through the product UI today — but the message must still be accurate
    // for any direct API caller, rather than claiming a structured CV (whose
    // parseStatus is already 'done') is "still being parsed".
    if (cv.parseStatus !== 'done') {
      throw new UnprocessableEntityException('CV is still being parsed. Please try again shortly.');
    }
    if (!cv.parsedContent) {
      throw new UnprocessableEntityException(
        'Analysis requires an uploaded CV with extracted text. Builder, prefilled, or tailored CVs ' +
          'are not yet supported for analysis — use Job Tailoring instead.',
      );
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

      // Deterministic backstop on top of the prompt's grounding instructions
      // (see ai.service.ts) — never trusts the model's wording or its own
      // ats_keywords `found` flags at face value. match_score (the model's
      // own holistic 0-100 estimate) is left untouched — this only affects
      // suggestion text and, via classifyAndVerifyKeywords/computeAtsScore
      // below, the separate ATS keyword score.
      const { suggestions: groundedSuggestions, stats } = groundSuggestions(
        result.suggestions,
        cv.parsedContent,
        result.ats_keywords,
      );
      if (stats.rewritten || stats.filteredFormatting || stats.deduped || stats.lowValueDropped) {
        this.logger.log(
          `Analysis ${analysisId}: recommendation grounding rewrote ${stats.rewritten}, ` +
            `filtered ${stats.filteredFormatting} unsupported formatting claim(s), ` +
            `removed ${stats.deduped} duplicate(s), dropped ${stats.lowValueDropped} low-value ` +
            'keyword recommendation(s)',
        );
      }

      // ATS Keyword Quality V2 — never trusts the model's raw keyword list
      // or `found` flags for scoring: classifyAndVerifyKeywords merges
      // near-duplicate phrasings, independently re-verifies `found` against
      // the actual CV text, and classifies each into an importance category
      // (see ats-keyword.util.ts). computeAtsScore then weights genuine
      // technical requirements far more heavily than generic/contextual
      // noise, which is excluded from scoring entirely rather than
      // depressing the score just for being absent. Pure computation, no
      // I/O — safe to run before the transaction below opens.
      const classifiedKeywords = classifyAndVerifyKeywords(result.ats_keywords, cv.parsedContent);
      const meaningfulKeywords = classifiedKeywords.filter(
        (k) => k.category !== 'GENERIC_OR_CONTEXTUAL',
      );
      const keywordHits = meaningfulKeywords
        .filter((k) => k.found)
        .map((k) => ({ keyword: k.keyword, found: k.found }));
      const missingKeywords = meaningfulKeywords.filter((k) => !k.found).map((k) => k.keyword);
      const atsScore = computeAtsScore(classifiedKeywords);

      // Reliability fix: the analysis result, its ATS report, and the
      // durable quota usage event are committed together in one short
      // transaction — never the external AI call above, only this final
      // persistence step. If logTransactional() fails, everything here
      // rolls back (the row is left at 'processing', then the outer catch
      // below marks it 'failed'), so a "successful" analysis can never
      // exist without its usage event, and a failed write can never
      // silently leave free/untracked usage. See AuditService.logTransactional.
      await this.dataSource.transaction(async (manager) => {
        await manager.update(AnalysisEntity, analysisId, {
          matchScore: result.match_score,
          suggestions: groundedSuggestions,
          modelUsed,
          tokensUsed,
          status: 'done',
          completedAt: new Date(),
        });

        await manager.save(
          manager.create(AtsReportEntity, { analysisId, keywordHits, missingKeywords, atsScore }),
        );

        await this.auditService.logTransactional(manager, {
          userId: analysis.userId,
          action: USAGE_ACTIONS.ANALYSIS_GENERATED,
          entityType: 'analysis',
          entityId: analysisId,
        });
      });

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

  // Genuine hard delete — analyses.id has no children other than
  // ats_reports (ON DELETE CASCADE, see InitialSchema migration), which
  // Postgres removes automatically; any cover_letters row that referenced
  // this analysis has analysis_id ON DELETE SET NULL, so it survives
  // untouched, just unlinked. The source CV is never touched — cv_id here
  // is the FK's child side, deleting this row cannot cascade "up" to it.
  async deleteAnalysis(clerkId: string, id: string): Promise<void> {
    const analysis = await this.findOneForUser(clerkId, id);
    await this.analysisRepo.delete(analysis.id);
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
