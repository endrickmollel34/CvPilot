import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { type Repository } from 'typeorm';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import type { ConfigService } from '@nestjs/config';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import type { Readable } from 'stream';

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

      const response = await this.s3.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: cv.r2ObjectKey }),
      );

      const fileBuffer = await this.streamToBuffer(response.Body as Readable);

      // TODO: branch on cv.mimeType
      //   'application/pdf' → pdf-parse(fileBuffer).then(d => d.text)
      //   'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      //       → mammoth.extractRawText({ buffer: fileBuffer }).then(r => r.value)
      const parsedContent = fileBuffer.length > 0 ? 'TODO: extracted text' : '';

      await this.cvRepo.update(cvId, { parsedContent, parseStatus: 'done' });
      this.logger.log(`CV ${cvId} parsed successfully`);
    } catch (err) {
      this.logger.error(`CV ${cvId} parsing failed`, err);
      await this.cvRepo.update(cvId, { parseStatus: 'failed' });
    }
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
