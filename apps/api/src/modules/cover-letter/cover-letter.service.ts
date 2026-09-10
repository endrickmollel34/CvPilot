import {
  Injectable,
  Logger,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { type Repository, type DataSource } from 'typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import type { Job } from 'bullmq';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ConfigService } from '@nestjs/config';
import type { Observable } from 'rxjs';
import { fromEvent } from 'rxjs';
import { filter, map } from 'rxjs/operators';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

import { CoverLetterEntity } from '../../entities/cover-letter.entity';
import { UserService } from '../user/user.service';
import { CvService } from '../cv/cv.service';
import { BillingService } from '../billing/billing.service';
import { AnalysisService } from '../analysis/analysis.service';
import { AuditService } from '../audit/audit.service';
import { USAGE_ACTIONS } from '../../common/constants/usage-actions';
import { CoverLetterAiService } from './cover-letter-ai.service';
import { resolveCoverLetterCvText } from './cv-text-resolver.util';
import { buildCvEvidenceFromContent, buildCvEvidenceFromPlainText } from './cv-evidence.util';
import { generateCoverLetterPdf } from './cover-letter-pdf.util';
import { R2StorageService } from '../../common/services/r2-storage.service';
import type { CreateCoverLetterDto } from './dto/create-cover-letter.dto';
import type { UpdateCoverLetterDto } from './dto/update-cover-letter.dto';
import type { ListCoverLettersDto } from './dto/list-cover-letters.dto';

const DOWNLOAD_URL_TTL_SECONDS = 900; // 15 minutes

export interface CoverLetterJobData {
  coverLetterId: string;
  userId: string;
  cvId: string;
  analysisId?: string;
  jobTitle: string;
  companyName: string;
  jobDescription: string;
  tone: string;
}

@Processor('cover-letter')
@Injectable()
export class CoverLetterService extends WorkerHost {
  private readonly logger = new Logger(CoverLetterService.name);
  private readonly s3: S3Client;
  private readonly bucket: string;

  constructor(
    @InjectRepository(CoverLetterEntity)
    private readonly repo: Repository<CoverLetterEntity>,
    @InjectQueue('cover-letter')
    private readonly queue: Queue,
    private readonly eventEmitter: EventEmitter2,
    private readonly config: ConfigService,
    private readonly userService: UserService,
    private readonly cvService: CvService,
    private readonly billingService: BillingService,
    private readonly analysisService: AnalysisService,
    private readonly auditService: AuditService,
    private readonly aiService: CoverLetterAiService,
    private readonly r2Storage: R2StorageService,
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {
    super();
    this.s3 = new S3Client({
      region: 'auto',
      endpoint: this.config.getOrThrow<string>('CLOUDFLARE_R2_ENDPOINT'),
      credentials: {
        accessKeyId: this.config.getOrThrow<string>('CLOUDFLARE_R2_ACCESS_KEY_ID'),
        secretAccessKey: this.config.getOrThrow<string>('CLOUDFLARE_R2_SECRET_ACCESS_KEY'),
      },
    });
    this.bucket = this.config.getOrThrow<string>('CLOUDFLARE_R2_BUCKET_NAME');
  }

  async submit(clerkId: string, dto: CreateCoverLetterDto): Promise<CoverLetterEntity> {
    const user = await this.userService.findByClerkId(clerkId);

    const cv = await this.cvService.findById(dto.cvId);
    if (cv.userId !== user.id) {
      throw new ForbiddenException('CV not found');
    }
    // A CV is usable for cover-letter generation once it has usable text
    // from EITHER source — see resolveCoverLetterCvText for why upload CVs
    // (parsedContent) and builder/prefill/tailored CVs (structured content)
    // never populate the same field.
    if (!resolveCoverLetterCvText(cv)) {
      throw new UnprocessableEntityException('CV is still being parsed. Please try again shortly.');
    }

    if (dto.analysisId) {
      // ownership check — throws 404 if not found or not owned by user
      await this.analysisService.findOneForUser(clerkId, dto.analysisId);
    }

    const canProceed = await this.billingService.canPerformAction(user.id, 'cover-letter');
    if (!canProceed) {
      throw new ForbiddenException(
        'Monthly cover letter limit reached. Upgrade your plan to continue.',
      );
    }

    const tone = dto.tone ?? 'professional';

    const letter = this.repo.create({
      userId: user.id,
      cvId: dto.cvId,
      analysisId: dto.analysisId,
      jobTitle: dto.jobTitle,
      companyName: dto.companyName,
      // V2 — persisted so the workspace can redisplay/edit these later and
      // so Regenerate has something to read back (see cover-letter.entity.ts).
      jobDescription: dto.jobDescription,
      recipientName: dto.recipientName,
      recipientTitle: dto.recipientTitle,
      companyAddress: dto.companyAddress,
      senderAddress: dto.senderAddress,
      tone,
      content: '',
      status: 'queued',
    });
    const saved = await this.repo.save(letter);

    await this.queue.add('generate-letter', {
      coverLetterId: saved.id,
      userId: user.id,
      cvId: dto.cvId,
      analysisId: dto.analysisId,
      jobTitle: dto.jobTitle,
      companyName: dto.companyName,
      jobDescription: dto.jobDescription,
      tone,
    } satisfies CoverLetterJobData);

    return saved;
  }

  async process(job: Job<CoverLetterJobData>): Promise<void> {
    const { coverLetterId, cvId, jobTitle, companyName, jobDescription, tone } = job.data;
    this.logger.log(`Generating cover letter ${coverLetterId}`);

    await this.repo.update(coverLetterId, { status: 'processing' });

    try {
      const cv = await this.cvService.findById(cvId);
      const cvText = resolveCoverLetterCvText(cv);
      if (!cvText) {
        throw new Error(`CV ${cvId} has no usable content`);
      }

      // Splits the CV into experience-vs-skills-only evidence tiers so the
      // AI service's grounding guard can tell "demonstrated experience"
      // apart from "listed skill only" (see cv-evidence.util.ts) — structured
      // CVs (builder/prefill/tailored) split exactly via their typed fields;
      // upload CVs get a lightweight heuristic split of the raw extracted
      // text (falls back to treating it all as experience evidence if no
      // recognisable section header is found).
      const evidence = cv.content
        ? buildCvEvidenceFromContent(cv.content)
        : buildCvEvidenceFromPlainText(cvText);

      const { content, modelUsed, tokensUsed } = await this.aiService.generateCoverLetter(
        cvText,
        jobDescription,
        jobTitle,
        companyName,
        tone,
        evidence,
      );

      // Reliability fix: the generated content/status and the durable quota
      // usage event are committed together in one short transaction — never
      // the external AI call above. If logTransactional() fails, the whole
      // transaction rolls back (the row is left at 'processing', then the
      // outer catch below marks it 'failed'), so a "successful" letter can
      // never exist without its usage event, and a failed write can never
      // silently leave free/untracked usage. Safe to log again on every
      // regenerate() of this same letter: the read side
      // (AuditService.countDistinctEntitiesSince) counts DISTINCT entity_id,
      // so a regenerated letter still only counts once. See
      // AuditService.logTransactional.
      await this.dataSource.transaction(async (manager) => {
        await manager.update(CoverLetterEntity, coverLetterId, {
          content,
          modelUsed,
          tokensUsed,
          status: 'generated',
          generatedAt: new Date(),
        });

        await this.auditService.logTransactional(manager, {
          userId: job.data.userId,
          action: USAGE_ACTIONS.COVER_LETTER_GENERATED,
          entityType: 'cover_letter',
          entityId: coverLetterId,
        });
      });

      this.eventEmitter.emit('cover-letter.completed', { coverLetterId });
      this.logger.log(`Cover letter ${coverLetterId} generated (model: ${modelUsed})`);
    } catch (err) {
      // Diagnostic-loss fix (see the module report): log the real message
      // in the primary log line itself, not just via Nest's `trace` param —
      // `err` here is already a safe, provider/validation-only message
      // string by the time it reaches this catch (see
      // cover-letter-ai.service.ts's describeError()/lastError handling),
      // never raw CV content or a secret. The stack, when available, still
      // goes through the dedicated `trace` argument Logger.error() expects
      // (a string), rather than passing the raw Error object as the
      // "context" label the way `.warn()`/`.log()` would treat it.
      const message = err instanceof Error ? err.message : String(err);
      const stack = err instanceof Error ? err.stack : undefined;
      this.logger.error(`Cover letter ${coverLetterId} generation failed: ${message}`, stack);
      await this.repo.update(coverLetterId, { status: 'failed' });
      this.eventEmitter.emit('cover-letter.failed', { coverLetterId });
    }
  }

  async listForUser(
    clerkId: string,
    dto: ListCoverLettersDto,
  ): Promise<{ items: CoverLetterEntity[]; total: number; page: number; limit: number }> {
    const user = await this.userService.findByClerkId(clerkId);
    const page = dto.page ?? 1;
    const limit = dto.limit ?? 20;

    // 'cv' is a LEFT JOIN — resolves to undefined rather than excluding the
    // letter if the source CV has since been (soft-)deleted.
    const [items, total] = await this.repo.findAndCount({
      where: { userId: user.id },
      relations: ['cv'],
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    return { items, total, page, limit };
  }

  async findOneForUser(clerkId: string, id: string): Promise<CoverLetterEntity> {
    const user = await this.userService.findByClerkId(clerkId);
    const letter = await this.repo.findOne({
      where: { id, userId: user.id },
      relations: ['cv'],
    });
    if (!letter) throw new NotFoundException(`Cover letter ${id} not found`);
    return letter;
  }

  // V2 — a genuine partial update: only the fields the caller actually
  // sent are touched. TypeORM's Repository.update() already skips any
  // property whose value is `undefined` (it only ever writes a column for
  // properties that are actually present) but DOES write an explicit
  // `null` (SET column = NULL) — that distinction is exactly what lets
  // senderAddress support "leave unchanged" (omitted) vs. "explicitly
  // cleared" (null) — passing dto's optional fields straight through is
  // safe and never accidentally nulls out an untouched column. See
  // update-cover-letter.dto.ts for why every field is optional.
  async update(clerkId: string, id: string, dto: UpdateCoverLetterDto): Promise<CoverLetterEntity> {
    const letter = await this.findOneForUser(clerkId, id);
    await this.repo.update(letter.id, {
      content: dto.content,
      jobTitle: dto.jobTitle,
      companyName: dto.companyName,
      jobDescription: dto.jobDescription,
      tone: dto.tone,
      recipientName: dto.recipientName,
      recipientTitle: dto.recipientTitle,
      companyAddress: dto.companyAddress,
      senderAddress: dto.senderAddress,
    });
    return this.repo.findOneByOrFail({ id: letter.id });
  }

  /**
   * Privacy/retention fix (see the module report): unlike a CV, nothing
   * else in the schema references a cover_letters row (no other table has
   * an FK to `cover_letters.id`), so — unlike CvService.deleteCv() —
   * there is no dependency conflict here and "delete" can mean a genuine
   * hard delete rather than a scrub-and-keep-soft-deleted compromise.
   * Renamed from the old softDelete() to make that behavior change
   * explicit rather than silently repurposing a method whose name implied
   * the opposite.
   *
   * Ordering fix (see the module report): the stored R2 PDF (if any) is
   * deleted FIRST; the row is only hard-deleted once that has genuinely
   * succeeded. The original order (hard-delete first, R2 best-effort
   * after) meant an R2 failure could leave the PDF behind in R2 while the
   * one row that recorded its key was already permanently gone — an
   * unrecoverable, silent privacy gap, even though the API had already
   * reported success. If the R2 delete fails here, the row is left fully
   * intact so the user can simply retry; R2's own DeleteObject is
   * idempotent, so a retry's R2 call is a harmless no-op if it actually
   * already succeeded — no compensation logic needed.
   */
  async deleteCoverLetter(clerkId: string, id: string): Promise<void> {
    const letter = await this.findOneForUser(clerkId, id);

    if (letter.r2ObjectKey) {
      const deleted = await this.r2Storage.deleteObject(letter.r2ObjectKey);
      if (!deleted) {
        throw new ServiceUnavailableException(
          "We couldn't delete this cover letter's stored file right now. Please try again in a moment.",
        );
      }
    }

    await this.repo.delete(letter.id);
  }

  /**
   * V2 — re-runs generation for an existing letter using whatever is
   * currently persisted (the workspace saves field edits via update()
   * before calling this, so "persisted" means "whatever the user last
   * saved"). Deliberately reuses the exact same BullMQ job/process()
   * pipeline submit() uses — same queue name, same CoverLetterJobData
   * shape, same AI service call — rather than introducing a second
   * generation path. Same billing gate as submit(): a regenerate is a
   * real AI call with a real cost, so it counts against the same monthly
   * quota.
   */
  async regenerate(clerkId: string, id: string): Promise<CoverLetterEntity> {
    const letter = await this.findOneForUser(clerkId, id);
    const user = await this.userService.findByClerkId(clerkId);

    if (!letter.jobTitle || !letter.companyName || !letter.jobDescription) {
      throw new UnprocessableEntityException(
        'Job title, company name, and job description are required to regenerate this letter.',
      );
    }

    const canProceed = await this.billingService.canPerformAction(user.id, 'cover-letter');
    if (!canProceed) {
      throw new ForbiddenException(
        'Monthly cover letter limit reached. Upgrade your plan to continue.',
      );
    }

    await this.repo.update(letter.id, { status: 'processing' });

    await this.queue.add('generate-letter', {
      coverLetterId: letter.id,
      userId: user.id,
      cvId: letter.cvId,
      analysisId: letter.analysisId,
      jobTitle: letter.jobTitle,
      companyName: letter.companyName,
      jobDescription: letter.jobDescription,
      tone: letter.tone ?? 'professional',
    } satisfies CoverLetterJobData);

    return this.repo.findOneByOrFail({ id: letter.id });
  }

  async getDownloadUrl(
    clerkId: string,
    id: string,
  ): Promise<{ downloadUrl: string; format: 'pdf' }> {
    const letter = await this.findOneForUser(clerkId, id);

    if (letter.status !== 'generated' && letter.status !== 'downloaded') {
      throw new UnprocessableEntityException('Cover letter is not ready for download yet.');
    }

    const personalDetails = letter.cv?.content?.personalDetails;

    const pdfBuffer = await generateCoverLetterPdf({
      candidateName: personalDetails?.fullName,
      email: personalDetails?.email,
      phone: personalDetails?.phone,
      location: personalDetails?.location,
      senderAddress: letter.senderAddress,
      date: letter.generatedAt ?? letter.createdAt,
      recipientName: letter.recipientName,
      recipientTitle: letter.recipientTitle,
      companyName: letter.companyName,
      companyAddress: letter.companyAddress,
      content: letter.content,
    });

    // Orphan-PDF fix (see the module report): deliberately deterministic —
    // one object per cover letter, keyed by the letter's own id rather
    // than a fresh randomUUID() per download. Every re-download simply
    // overwrites the same R2 object (a plain PUT to an existing key
    // replaces it) instead of creating a new one and abandoning the
    // previous, unlimited-orphan-accumulation behavior this replaces. Key
    // predictability is not a security property here — same as the CV
    // upload key, access is gated entirely by the short-lived presigned
    // URL below, never by the key itself being secret (the bucket is
    // private and never served except via a presigned URL).
    const r2Key = `cover-letters/${letter.userId}/${letter.id}.pdf`;

    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: r2Key,
        Body: pdfBuffer,
        ContentType: 'application/pdf',
      }),
    );

    const downloadUrl = await getSignedUrl(
      this.s3,
      new GetObjectCommand({ Bucket: this.bucket, Key: r2Key }),
      { expiresIn: DOWNLOAD_URL_TTL_SECONDS },
    );

    await this.repo.update(letter.id, { r2ObjectKey: r2Key, status: 'downloaded' });

    return { downloadUrl, format: 'pdf' };
  }

  statusStream(coverLetterId: string): Observable<MessageEvent> {
    return fromEvent(this.eventEmitter, 'cover-letter.completed').pipe(
      filter(
        (data): data is { coverLetterId: string } =>
          typeof data === 'object' &&
          data !== null &&
          (data as Record<string, unknown>)['coverLetterId'] === coverLetterId,
      ),
      map((data) => ({ data }) as MessageEvent),
    );
  }
}
