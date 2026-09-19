import { randomUUID } from 'crypto';
import type { Readable } from 'stream';

import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  CopyObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

import { CvEntity } from '../../entities/cv.entity';
import { UserService } from '../user/user.service';
import { R2StorageService } from '../../common/services/r2-storage.service';
import type { PhotoUploadUrlDto } from './dto/photo-upload-url.dto';
import { MAX_PHOTO_SIZE_BYTES } from './dto/photo-upload-url.dto';
import type { ConfirmPhotoUploadDto } from './dto/confirm-photo-upload.dto';
import { validateImageBytes, type ImageDimensions } from './utils/image-validation.util';

const PRESIGNED_UPLOAD_TTL_SECONDS = 900; // 15 minutes
const PRESIGNED_PREVIEW_TTL_SECONDS = 300; // 5 minutes — never persisted

const EXTENSION_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
};

interface OwnedCv {
  cv: CvEntity;
  userId: string;
}

/**
 * Profile template's optional photo — its own dedicated service, mirroring
 * (not reusing) CvService's own verified-pending-upload R2 pattern for CV
 * files: presign into a pending-cv-photos/ prefix, HEAD-verify the real object
 * once the browser's direct-to-R2 PUT completes, THEN promote to a
 * permanent key. Kept as a separate service (not folded into the already
 * large CvService) so CvService can depend on it one-way, for photo bytes
 * at PDF-render time, without CvPhotoService needing to depend back on
 * CvService for ownership checks — this file resolves ownership itself
 * (UserService + the same CvEntity repository CvService uses), the exact
 * same two primitives CvService.findOneForUser itself is built from, so no
 * circular module dependency is introduced.
 *
 * The photo object key is intentionally never made public — every read
 * path is a short-lived presigned GET (getPreviewUrl) or a direct
 * server-side download (getPhotoBytes, used only by PdfGenerationService).
 */
@Injectable()
export class CvPhotoService {
  private readonly logger = new Logger(CvPhotoService.name);
  private readonly s3: S3Client;
  private readonly bucket: string;
  private readonly r2Configured: boolean;

  constructor(
    @InjectRepository(CvEntity)
    private readonly cvRepo: Repository<CvEntity>,
    private readonly config: ConfigService,
    private readonly userService: UserService,
    private readonly r2Storage: R2StorageService,
  ) {
    const endpoint = this.config.getOrThrow<string>('CLOUDFLARE_R2_ENDPOINT');
    const accessKeyId = this.config.getOrThrow<string>('CLOUDFLARE_R2_ACCESS_KEY_ID');
    const secretAccessKey = this.config.getOrThrow<string>('CLOUDFLARE_R2_SECRET_ACCESS_KEY');
    this.bucket = this.config.getOrThrow<string>('CLOUDFLARE_R2_BUCKET_NAME');

    this.r2Configured = ![endpoint, accessKeyId, secretAccessKey, this.bucket].some((v) =>
      v.includes('placeholder'),
    );

    this.s3 = new S3Client({
      region: 'auto',
      endpoint,
      credentials: { accessKeyId, secretAccessKey },
    });
  }

  /** Same ownership resolution as CvService.findOneForUser — deliberately
   *  re-derived here (not imported) to avoid a circular CvModule
   *  dependency (see this class's own doc comment). */
  private async findOwnedCv(clerkId: string, cvId: string): Promise<OwnedCv> {
    const user = await this.userService.findByClerkId(clerkId);
    const cv = await this.cvRepo.findOne({ where: { id: cvId, userId: user.id } });
    if (!cv) throw new NotFoundException(`CV ${cvId} not found`);
    return { cv, userId: user.id };
  }

  async generateUploadUrl(
    clerkId: string,
    cvId: string,
    dto: PhotoUploadUrlDto,
  ): Promise<{ uploadUrl: string; r2ObjectKey: string }> {
    if (!this.r2Configured) {
      throw new ServiceUnavailableException(
        'File storage is not configured for this environment. Set CLOUDFLARE_R2_* in apps/api/.env to enable photo uploads.',
      );
    }
    const { userId } = await this.findOwnedCv(clerkId, cvId);

    const ext = EXTENSION_BY_MIME[dto.mimeType];
    if (!ext) throw new BadRequestException('Unsupported image type.');

    // Same pending-prefix-then-promote rationale as CvService's own CV
    // upload flow — dto.fileSizeBytes is client-declared and unverified
    // until confirmUpload() HEAD-checks the real object.
    const r2ObjectKey = `pending-cv-photos/${userId}/${cvId}/${randomUUID()}.${ext}`;

    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: r2ObjectKey,
      ContentType: dto.mimeType,
    });
    const uploadUrl = await getSignedUrl(this.s3, command, {
      expiresIn: PRESIGNED_UPLOAD_TTL_SECONDS,
    });

    return { uploadUrl, r2ObjectKey };
  }

  async confirmUpload(
    clerkId: string,
    cvId: string,
    dto: ConfirmPhotoUploadDto,
  ): Promise<CvEntity> {
    const { cv, userId } = await this.findOwnedCv(clerkId, cvId);

    const pendingPrefix = `pending-cv-photos/${userId}/${cvId}/`;
    if (!dto.r2ObjectKey.startsWith(pendingPrefix)) {
      throw new ForbiddenException('Invalid upload reference.');
    }
    const pendingKey = dto.r2ObjectKey;

    let actualSizeBytes: number;
    try {
      const head = await this.s3.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: pendingKey }),
      );
      if (typeof head.ContentLength !== 'number' || !Number.isFinite(head.ContentLength)) {
        throw new ServiceUnavailableException(
          "We couldn't verify the uploaded photo right now. Please try again.",
        );
      }
      actualSizeBytes = head.ContentLength;
    } catch (err) {
      if (err instanceof ServiceUnavailableException) throw err;
      if (err instanceof Error && err.name === 'NotFound') {
        throw new NotFoundException('Uploaded photo not found. Please try uploading again.');
      }
      const errorType = err instanceof Error ? err.name : 'UnknownError';
      this.logger.warn(`R2 HEAD failed during photo confirmUpload (error: ${errorType})`);
      throw new ServiceUnavailableException(
        "We couldn't verify the uploaded photo right now. Please try again.",
      );
    }

    if (actualSizeBytes > MAX_PHOTO_SIZE_BYTES) {
      await this.r2Storage.deleteObject(pendingKey);
      throw new UnprocessableEntityException('Profile photos must be 3 MB or smaller.');
    }

    const buffer = await this.downloadObject(pendingKey);
    const dimensions = validateImageBytes(buffer, dto.mimeType);
    if (!dimensions) {
      await this.r2Storage.deleteObject(pendingKey);
      throw new UnprocessableEntityException(
        'This file is not a valid PNG or JPEG image. Please try a different photo.',
      );
    }

    // Reuses pendingKey's own already-UUID-unique suffix (which already
    // carries the correct extension) rather than generating a new one —
    // same convention as CvService.confirmUpload's own promotion step.
    const permanentKey = `cv-photos/${userId}/${cvId}-${pendingKey.slice(pendingPrefix.length)}`;
    try {
      await this.s3.send(
        new CopyObjectCommand({
          Bucket: this.bucket,
          CopySource: `${this.bucket}/${pendingKey}`,
          Key: permanentKey,
        }),
      );
    } catch (err) {
      const errorType = err instanceof Error ? err.name : 'UnknownError';
      this.logger.warn(`R2 promote-copy failed during photo confirmUpload (error: ${errorType})`);
      throw new ServiceUnavailableException(
        "We couldn't finish saving your photo. Please try again.",
      );
    }
    await this.r2Storage.deleteObject(pendingKey);

    const previousKey = cv.photoObjectKey;
    await this.cvRepo.update(cvId, { photoObjectKey: permanentKey });

    // Clean up the previous photo (replacement case) only AFTER the new
    // key is safely persisted — same ordering principle as
    // CvService.deleteCv's own doc comment: never lose the only pointer to
    // an object before it's actually removed.
    if (previousKey && previousKey !== permanentKey) {
      await this.r2Storage.deleteObject(previousKey);
    }

    return this.cvRepo.findOneByOrFail({ id: cvId });
  }

  async removePhoto(clerkId: string, cvId: string): Promise<CvEntity> {
    const { cv } = await this.findOwnedCv(clerkId, cvId);
    if (!cv.photoObjectKey) return cv;

    const deleted = await this.r2Storage.deleteObject(cv.photoObjectKey);
    if (!deleted) {
      throw new ServiceUnavailableException(
        "We couldn't remove this photo right now. Please try again in a moment.",
      );
    }
    // photoObjectKey is typed `string | undefined` (see CvEntity's own
    // doc comment) — same `any` escape hatch CvService.deleteCv already
    // uses to write a literal `null` into a nullable-but-optional column.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await this.cvRepo.update(cvId, { photoObjectKey: null } as any);
    return this.cvRepo.findOneByOrFail({ id: cvId });
  }

  async getPreviewUrl(clerkId: string, cvId: string): Promise<{ previewUrl: string | null }> {
    const { cv } = await this.findOwnedCv(clerkId, cvId);
    if (!cv.photoObjectKey) return { previewUrl: null };

    const previewUrl = await getSignedUrl(
      this.s3,
      new GetObjectCommand({ Bucket: this.bucket, Key: cv.photoObjectKey }),
      { expiresIn: PRESIGNED_PREVIEW_TTL_SECONDS },
    );
    return { previewUrl };
  }

  /**
   * Server-side bytes for the PDFKit renderer (see profile-pdf-renderer.ts)
   * — never exposed to a client. Re-validates the downloaded bytes rather
   * than trusting a stored width/height, so a photo already accepted at
   * upload time can never crash PDF generation; on ANY problem this
   * returns `null` and the caller renders the no-photo header instead —
   * it must never delete or otherwise touch the CV's existing photo
   * association, since a transient R2/network issue is not evidence the
   * photo itself is invalid.
   */
  async getPhotoBytes(
    photoObjectKey: string,
  ): Promise<{ buffer: Buffer; dimensions: ImageDimensions } | null> {
    try {
      const buffer = await this.downloadObject(photoObjectKey);
      if (buffer.length > MAX_PHOTO_SIZE_BYTES) return null;
      const mimeType = photoObjectKey.endsWith('.png') ? 'image/png' : 'image/jpeg';
      const dimensions = validateImageBytes(buffer, mimeType);
      if (!dimensions) return null;
      return { buffer, dimensions };
    } catch (err) {
      const errorType = err instanceof Error ? err.name : 'UnknownError';
      this.logger.warn(`Failed to load photo bytes for PDF render (error: ${errorType})`);
      return null;
    }
  }

  private async downloadObject(key: string): Promise<Buffer> {
    const response = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    return this.streamToBuffer(response.Body as Readable);
  }

  private streamToBuffer(stream: Readable): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      stream.on('data', (chunk: Buffer) => chunks.push(chunk));
      stream.on('end', () => resolve(Buffer.concat(chunks)));
      stream.on('error', reject);
    });
  }
}
