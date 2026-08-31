import { randomUUID } from 'crypto';

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
import { ConfigService } from '@nestjs/config';
import type { Observable } from 'rxjs';
import { fromEvent } from 'rxjs';
import { filter, map } from 'rxjs/operators';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import PDFDocument from 'pdfkit';

import { CoverLetterEntity } from '../../entities/cover-letter.entity';
import { UserService } from '../user/user.service';
import { CvService } from '../cv/cv.service';
import { BillingService } from '../billing/billing.service';
import { AnalysisService } from '../analysis/analysis.service';
import { CoverLetterAiService } from './cover-letter-ai.service';
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
    private readonly aiService: CoverLetterAiService,
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
    if (cv.parseStatus !== 'done' || !cv.parsedContent) {
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
      if (!cv.parsedContent) {
        throw new Error(`CV ${cvId} has no parsed content`);
      }

      // Structured skills, when available (builder/prefill/tailored CVs),
      // are supplied as an extra evidence block alongside the raw parsed
      // text. Upload-only CVs with no structured content simply pass
      // undefined here and generation proceeds off parsedContent alone.
      const candidateSkills = cv.content?.skills.map((s) => s.name);

      const { content, modelUsed, tokensUsed } = await this.aiService.generateCoverLetter(
        cv.parsedContent,
        jobDescription,
        jobTitle,
        companyName,
        tone,
        candidateSkills,
      );

      await this.repo.update(coverLetterId, {
        content,
        modelUsed,
        tokensUsed,
        status: 'generated',
        generatedAt: new Date(),
      });

      this.eventEmitter.emit('cover-letter.completed', { coverLetterId });
      this.logger.log(`Cover letter ${coverLetterId} generated (model: ${modelUsed})`);
    } catch (err) {
      this.logger.error(`Cover letter ${coverLetterId} generation failed`, err);
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

  async update(clerkId: string, id: string, dto: UpdateCoverLetterDto): Promise<CoverLetterEntity> {
    const letter = await this.findOneForUser(clerkId, id);
    await this.repo.update(letter.id, { content: dto.content });
    return this.repo.findOneByOrFail({ id: letter.id });
  }

  async softDelete(clerkId: string, id: string): Promise<void> {
    const letter = await this.findOneForUser(clerkId, id);
    await this.repo.softDelete(letter.id);
  }

  async getDownloadUrl(
    clerkId: string,
    id: string,
  ): Promise<{ downloadUrl: string; format: 'pdf' }> {
    const letter = await this.findOneForUser(clerkId, id);

    if (letter.status !== 'generated' && letter.status !== 'downloaded') {
      throw new UnprocessableEntityException('Cover letter is not ready for download yet.');
    }

    const pdfBuffer = await this.generatePdf(
      letter.content,
      letter.jobTitle ?? '',
      letter.companyName ?? '',
    );

    const r2Key = `cover-letters/${letter.userId}/${randomUUID()}.pdf`;

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

  private generatePdf(content: string, jobTitle: string, companyName: string): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ margin: 72 });
      const chunks: Buffer[] = [];
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      if (jobTitle && companyName) {
        doc
          .fontSize(14)
          .font('Helvetica-Bold')
          .text(`${jobTitle} — ${companyName}`, { align: 'left' });
        doc.moveDown(1);
      }

      doc.fontSize(11).font('Helvetica').text(content, { lineGap: 4 });
      doc.end();
    });
  }
}
