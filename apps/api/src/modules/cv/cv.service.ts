import { randomUUID } from 'crypto';

import {
  Injectable,
  ForbiddenException,
  NotFoundException,
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
import { CvEntity } from '../../entities/cv.entity';
import { UserService } from '../user/user.service';
import { BillingService } from '../billing/billing.service';
import type { GenerateUploadUrlDto } from './dto/generate-upload-url.dto';
import type { ConfirmUploadDto } from './dto/confirm-upload.dto';
import type { CreateCvDto } from './dto/create-cv.dto';
import type { UpdateCvContentDto } from './dto/update-cv-content.dto';
import type { RenameCvDto } from './dto/rename-cv.dto';
import type { ReorderCvSectionsDto } from './dto/reorder-cv-sections.dto';

const PRESIGNED_URL_TTL_SECONDS = 900; // 15 minutes

@Injectable()
export class CvService {
  private readonly s3: S3Client;
  private readonly bucket: string;

  constructor(
    @InjectRepository(CvEntity)
    private readonly cvRepo: Repository<CvEntity>,
    @InjectQueue('cv-parsing')
    private readonly parsingQueue: Queue,
    private readonly config: ConfigService,
    private readonly userService: UserService,
    private readonly billingService: BillingService,
  ) {
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

  async generateUploadUrl(clerkId: string, dto: GenerateUploadUrlDto) {
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

  private async checkBuilderCvLimit(userId: string): Promise<void> {
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
