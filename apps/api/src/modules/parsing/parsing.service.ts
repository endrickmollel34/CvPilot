import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { type Repository } from 'typeorm';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';

import { CvEntity } from '../../entities/cv.entity';

@Processor('cv-parsing')
@Injectable()
export class ParsingService extends WorkerHost {
  private readonly logger = new Logger(ParsingService.name);

  constructor(
    @InjectRepository(CvEntity)
    private readonly cvRepo: Repository<CvEntity>,
  ) {
    super();
  }

  async process(job: Job<{ cvId: string }>): Promise<void> {
    const { cvId } = job.data;
    this.logger.log(`Parsing CV ${cvId}`);

    await this.cvRepo.update(cvId, { parseStatus: 'processing' });

    try {
      // TODO: fetch file from R2 using S3Client
      // TODO: extract text from PDF via pdf-parse, DOCX via mammoth
      // TODO: detect section headers, bullet points
      const parsedContent = 'TODO: extracted text';
      await this.cvRepo.update(cvId, { parsedContent, parseStatus: 'done' });
      this.logger.log(`CV ${cvId} parsed successfully`);
    } catch (err) {
      this.logger.error(`CV ${cvId} parsing failed`, err);
      await this.cvRepo.update(cvId, { parseStatus: 'failed' });
    }
  }
}
