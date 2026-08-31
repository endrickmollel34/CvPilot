import { randomUUID } from 'crypto';

import {
  Injectable,
  ForbiddenException,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { type Repository, In } from 'typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { ConfigService } from '@nestjs/config';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

import { PLAN_LIMITS } from '@cvpilot/shared';
import type { CvContent } from '@cvpilot/shared';
import { CvEntity } from '../../entities/cv.entity';
import { isDevQuotaBypassActive } from '../../common/utils/dev-quota-bypass.util';
import { UserService } from '../user/user.service';
import { BillingService } from '../billing/billing.service';
import { PrefillExtractionService } from './prefill-extraction.service';
import { PdfGenerationService } from './pdf-generation.service';
import type { GenerateUploadUrlDto } from './dto/generate-upload-url.dto';
import type { ConfirmUploadDto } from './dto/confirm-upload.dto';
import type { CreateCvDto } from './dto/create-cv.dto';
import type { UpdateCvContentDto } from './dto/update-cv-content.dto';
import type { RenameCvDto } from './dto/rename-cv.dto';
import type { ReorderCvSectionsDto } from './dto/reorder-cv-sections.dto';

const PRESIGNED_URL_TTL_SECONDS = 900; // 15 minutes

@Injectable()
export class CvService {
  private readonly logger = new Logger(CvService.name);
  private readonly s3: S3Client;
  private readonly bucket: string;
  private readonly r2Configured: boolean;

  constructor(
    @InjectRepository(CvEntity)
    private readonly cvRepo: Repository<CvEntity>,
    @InjectQueue('cv-parsing')
    private readonly parsingQueue: Queue,
    private readonly config: ConfigService,
    private readonly userService: UserService,
    private readonly billingService: BillingService,
    private readonly prefillService: PrefillExtractionService,
    private readonly pdfService: PdfGenerationService,
  ) {
    const endpoint = this.config.getOrThrow<string>('CLOUDFLARE_R2_ENDPOINT');
    const accessKeyId = this.config.getOrThrow<string>('CLOUDFLARE_R2_ACCESS_KEY_ID');
    const secretAccessKey = this.config.getOrThrow<string>('CLOUDFLARE_R2_SECRET_ACCESS_KEY');
    this.bucket = this.config.getOrThrow<string>('CLOUDFLARE_R2_BUCKET_NAME');

    this.r2Configured = ![endpoint, accessKeyId, secretAccessKey, this.bucket].some((v) =>
      v.includes('placeholder'),
    );
    if (!this.r2Configured) {
      this.logger.warn(
        'CLOUDFLARE_R2_* env vars are placeholders — CV upload requests will be rejected ' +
          'with a clear error until real Cloudflare R2 credentials are configured in apps/api/.env.',
      );
    }

    this.s3 = new S3Client({
      region: 'auto',
      endpoint,
      credentials: { accessKeyId, secretAccessKey },
    });
  }

  async generateUploadUrl(clerkId: string, dto: GenerateUploadUrlDto) {
    if (!this.r2Configured) {
      throw new ServiceUnavailableException(
        'File storage is not configured for this environment. Set CLOUDFLARE_R2_* in apps/api/.env to enable CV uploads.',
      );
    }

    const user = await this.userService.findByClerkId(clerkId);

    const canProceed = await this.billingService.canPerformAction(user.id, 'analyse');
    if (!canProceed) {
      throw new ForbiddenException(
        'Monthly analysis limit reached. Upgrade your plan to continue.',
      );
    }

    const safeFileName = dto.fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
    const r2ObjectKey = `cvs/${user.id}/${randomUUID()}-${safeFileName}`;

    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: r2ObjectKey,
      ContentType: dto.mimeType,
      ContentLength: dto.fileSizeBytes,
    });

    const uploadUrl = await getSignedUrl(this.s3, command, {
      expiresIn: PRESIGNED_URL_TTL_SECONDS,
    });

    return { uploadUrl, r2ObjectKey };
  }

  async confirmUpload(clerkId: string, dto: ConfirmUploadDto) {
    const user = await this.userService.findByClerkId(clerkId);

    // The presigned URL issued by generateUploadUrl always scopes the R2 key
    // under this exact prefix; a client submitting a key outside its own
    // namespace (someone else's, or a malformed one) is rejected rather than
    // trusted, so a CV row can never be created pointing at another user's —
    // or a nonexistent — R2 object. Deliberately generic error: this must
    // not confirm or deny another user's key even exists.
    if (!dto.r2ObjectKey.startsWith(`cvs/${user.id}/`)) {
      throw new ForbiddenException('Invalid upload reference.');
    }

    const cv = this.cvRepo.create({
      userId: user.id,
      source: 'upload',
      fileName: dto.fileName,
      r2ObjectKey: dto.r2ObjectKey,
      fileSizeBytes: dto.fileSizeBytes,
      mimeType: dto.mimeType,
      parseStatus: 'pending',
    });

    const saved = await this.cvRepo.save(cv);
    await this.parsingQueue.add('parse-cv', { cvId: saved.id });
    return saved;
  }

  async createBuilder(clerkId: string, dto: CreateCvDto): Promise<CvEntity> {
    const user = await this.userService.findByClerkId(clerkId);
    await this.checkBuilderCvLimit(user.id);

    const cv = this.cvRepo.create({
      userId: user.id,
      title: dto.title,
      source: dto.source ?? 'builder',
      parseStatus: 'done',
      isActive: true,
    });
    return this.cvRepo.save(cv);
  }

  async updateContent(clerkId: string, cvId: string, dto: UpdateCvContentDto): Promise<CvEntity> {
    const cv = await this.findOneForUser(clerkId, cvId);
    if (cv.source === 'upload') {
      throw new ForbiddenException('Uploaded CVs cannot be edited in the builder.');
    }
    await this.cvRepo.update(cvId, { content: dto.content });
    return this.cvRepo.findOneByOrFail({ id: cvId });
  }

  async rename(clerkId: string, cvId: string, dto: RenameCvDto): Promise<CvEntity> {
    await this.findOneForUser(clerkId, cvId);
    await this.cvRepo.update(cvId, { title: dto.title });
    return this.cvRepo.findOneByOrFail({ id: cvId });
  }

  async reorderSections(
    clerkId: string,
    cvId: string,
    dto: ReorderCvSectionsDto,
  ): Promise<CvEntity> {
    const cv = await this.findOneForUser(clerkId, cvId);
    if (!cv.content) {
      throw new UnprocessableEntityException('CV has no content to reorder.');
    }
    await this.cvRepo.update(cvId, {
      content: { ...cv.content, sectionOrder: dto.sectionOrder },
    });
    return this.cvRepo.findOneByOrFail({ id: cvId });
  }

  async deleteCv(clerkId: string, cvId: string): Promise<void> {
    await this.findOneForUser(clerkId, cvId);
    await this.cvRepo.softDelete(cvId);
  }

  async listForUser(clerkId: string) {
    const user = await this.userService.findByClerkId(clerkId);
    return this.cvRepo.find({
      where: { userId: user.id, isActive: true },
      order: { createdAt: 'DESC' },
    });
  }

  async findOneForUser(clerkId: string, cvId: string) {
    const user = await this.userService.findByClerkId(clerkId);
    const cv = await this.cvRepo.findOne({ where: { id: cvId, userId: user.id } });
    if (!cv) throw new NotFoundException(`CV ${cvId} not found`);
    return cv;
  }

  async findById(cvId: string) {
    const cv = await this.cvRepo.findOneBy({ id: cvId });
    if (!cv) throw new NotFoundException(`CV ${cvId} not found`);
    return cv;
  }

  async prefillFromUpload(clerkId: string, uploadCvId: string): Promise<CvEntity> {
    const user = await this.userService.findByClerkId(clerkId);

    const uploadCv = await this.cvRepo.findOne({ where: { id: uploadCvId, userId: user.id } });
    if (!uploadCv) throw new NotFoundException(`CV ${uploadCvId} not found`);

    if (uploadCv.source !== 'upload') {
      throw new UnprocessableEntityException(
        'Only uploaded CVs can be used to prefill a builder CV.',
      );
    }

    if (uploadCv.parseStatus !== 'done') {
      throw new UnprocessableEntityException(
        'CV text has not been fully extracted yet. Please try again in a moment.',
      );
    }

    if (!uploadCv.parsedContent?.trim()) {
      throw new UnprocessableEntityException(
        'No text was extracted from this CV. The file may be empty or unsupported.',
      );
    }

    // Idempotency: return existing prefill CV for this upload (non-deleted)
    const existing = await this.cvRepo.findOne({
      where: { sourceUploadCvId: uploadCvId, userId: user.id },
    });
    if (existing) return existing;

    await this.checkBuilderCvLimit(user.id);

    // Diagnostic only — length, never content, so this is safe to log
    // (no PII). A very short length here is a strong signal that
    // parsedContent is placeholder/garbage text rather than a real CV body.
    this.logger.log(
      `Prefilling CV ${uploadCvId} from ${uploadCv.parsedContent.length} chars of parsed text`,
    );

    const extraction = await this.prefillService.extract(uploadCv.parsedContent);

    const cv = this.cvRepo.create({
      userId: user.id,
      title: uploadCv.title ?? uploadCv.fileName ?? 'Prefilled CV',
      source: 'prefill',
      parseStatus: 'done',
      isActive: true,
      content: extraction.content,
      sourceUploadCvId: uploadCvId,
      prefillExtractedAt: new Date(),
      prefillModel: extraction.modelUsed,
      prefillTokensUsed: extraction.tokensUsed,
      prefillVersion: extraction.version,
    });

    return this.cvRepo.save(cv);
  }

  async generatePdfStream(
    clerkId: string,
    cvId: string,
  ): Promise<{ stream: import('stream').PassThrough; filename: string }> {
    const cv = await this.findOneForUser(clerkId, cvId);
    if (!cv.content) {
      throw new UnprocessableEntityException('This CV has no builder content to export.');
    }
    const stream = this.pdfService.generateStream(cv.content, cv.title ?? 'CV');
    const safe = (cv.title ?? 'cv').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80);
    return { stream, filename: `${safe}.pdf` };
  }

  async createTailored(userId: string, content: CvContent, jobTitle?: string): Promise<CvEntity> {
    const title = jobTitle ? `Tailored CV — ${jobTitle}` : 'Tailored CV';
    const cv = this.cvRepo.create({
      userId,
      title,
      source: 'tailored',
      parseStatus: 'done',
      isActive: true,
      content,
    });
    return this.cvRepo.save(cv);
  }

  private async checkBuilderCvLimit(userId: string): Promise<void> {
    // DEV-ONLY quota bypass — see dev-quota-bypass.util.ts for the full
    // rationale. Never active outside NODE_ENV=development.
    if (isDevQuotaBypassActive()) return;

    const plan = await this.billingService.getUserPlan(userId);
    const limit = PLAN_LIMITS[plan].builderCvsTotal;
    if (limit === Infinity) return;

    const count = await this.cvRepo.count({
      where: { userId, source: In(['builder', 'prefill']) },
    });

    if (count >= limit) {
      throw new ForbiddenException(
        'Builder CV limit reached. Upgrade your plan to create more CVs.',
      );
    }
  }
}
