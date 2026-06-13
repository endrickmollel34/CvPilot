import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { type Repository } from 'typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';

import { CvEntity } from '../../entities/cv.entity';

const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
];
const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB

@Injectable()
export class CvService {
  constructor(
    @InjectRepository(CvEntity)
    private readonly cvRepo: Repository<CvEntity>,
    @InjectQueue('cv-parsing')
    private readonly parsingQueue: Queue,
  ) {}

  async generateUploadUrl(
    clerkId: string,
    body: { fileName: string; mimeType: string; fileSizeBytes: number },
  ) {
    if (!ALLOWED_MIME_TYPES.includes(body.mimeType)) {
      throw new BadRequestException('Only PDF and DOCX files are accepted');
    }
    if (body.fileSizeBytes > MAX_FILE_SIZE_BYTES) {
      throw new BadRequestException('File must be under 5 MB');
    }
    // TODO: generate presigned R2 PUT URL via S3Client + getSignedUrl (15-min TTL)
    // TODO: verify clerkId maps to a user and check subscription limits via BillingService
    return { uploadUrl: 'TODO', r2ObjectKey: 'TODO' };
  }

  async confirmUpload(
    clerkId: string,
    body: { r2ObjectKey: string; fileName: string; fileSizeBytes: number; mimeType: string },
  ) {
    // TODO: resolve clerkId → userId
    const cv = this.cvRepo.create({
      fileName: body.fileName,
      r2ObjectKey: body.r2ObjectKey,
      fileSizeBytes: body.fileSizeBytes,
      mimeType: body.mimeType,
      parseStatus: 'pending',
    });
    const saved = await this.cvRepo.save(cv);
    await this.parsingQueue.add('parse-cv', { cvId: saved.id });
    return saved;
  }

  async listForUser(_clerkId: string) {
    // TODO: resolve clerkId → userId, then filter
    return this.cvRepo.find({ where: { isActive: true } });
  }

  async findOneForUser(_clerkId: string, cvId: string) {
    // TODO: enforce user_id scoping
    return this.cvRepo.findOneByOrFail({ id: cvId });
  }
}
