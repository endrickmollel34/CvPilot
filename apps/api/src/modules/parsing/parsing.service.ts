import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { type Repository } from 'typeorm';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { ConfigService } from '@nestjs/config';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import type { Readable } from 'stream';
import { PDFParse } from 'pdf-parse';
import mammoth from 'mammoth';

import { CvEntity } from '../../entities/cv.entity';

@Processor('cv-parsing')
@Injectable()
export class ParsingService extends WorkerHost {
  private readonly logger = new Logger(ParsingService.name);
  private readonly s3: S3Client;
  private readonly bucket: string;

  constructor(
    @InjectRepository(CvEntity)
    private readonly cvRepo: Repository<CvEntity>,
    private readonly config: ConfigService,
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

  async process(job: Job<{ cvId: string }>): Promise<void> {
    const { cvId } = job.data;
    this.logger.log(`Parsing CV ${cvId}`);

    await this.cvRepo.update(cvId, { parseStatus: 'processing' });

    try {
      const cv = await this.cvRepo.findOneByOrFail({ id: cvId });

      if (!cv.r2ObjectKey) {
        // Builder CVs have no R2 file — mark done immediately
        await this.cvRepo.update(cvId, { parseStatus: 'done' });
        this.logger.log(`CV ${cvId} is a builder CV — skipping file parse`);
        return;
      }

      const response = await this.s3.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: cv.r2ObjectKey }),
      );

      const fileBuffer = await this.streamToBuffer(response.Body as Readable);
      const parsedContent = await this.extractText(fileBuffer, cv.mimeType);

      if (!parsedContent.trim()) {
        // Extraction ran without error but found no text (e.g. a scanned/
        // image-only PDF with no text layer). Surface this as a failure
        // rather than persisting empty text that would silently make
        // downstream AI prefill/analysis look like it "succeeded" with
        // nothing to work from.
        throw new Error('No text content could be extracted from the file');
      }

      await this.cvRepo.update(cvId, { parsedContent, parseStatus: 'done' });
      this.logger.log(`CV ${cvId} parsed successfully (${parsedContent.length} chars extracted)`);
    } catch (err) {
      this.logger.error(`CV ${cvId} parsing failed`, err);
      await this.cvRepo.update(cvId, { parseStatus: 'failed' });
    }
  }

  /**
   * Extracts raw text from an uploaded CV file so it can be fed to the AI
   * prefill/analysis pipeline. Dispatches on the stored MIME type — see
   * ALLOWED_MIME_TYPES in dto/generate-upload-url.dto.ts for the exhaustive
   * set of file types the upload flow accepts.
   */
  private async extractText(fileBuffer: Buffer, mimeType?: string): Promise<string> {
    if (fileBuffer.length === 0) return '';

    if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
      const result = await mammoth.extractRawText({ buffer: fileBuffer });
      return result.value.trim();
    }

    if (mimeType === 'application/pdf') {
      const parser = new PDFParse({ data: fileBuffer });
      try {
        const result = await parser.getText();
        return result.text.trim();
      } finally {
        await parser.destroy();
      }
    }

    throw new Error(`Unsupported CV file type for text extraction: ${String(mimeType)}`);
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
