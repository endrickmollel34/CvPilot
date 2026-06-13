import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { type Repository } from 'typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Queue, Job } from 'bullmq';

import { CoverLetterEntity } from '../../entities/cover-letter.entity';

@Processor('cover-letter')
@Injectable()
export class CoverLetterService extends WorkerHost {
  private readonly logger = new Logger(CoverLetterService.name);

  constructor(
    @InjectRepository(CoverLetterEntity)
    private readonly repo: Repository<CoverLetterEntity>,
    @InjectQueue('cover-letter')
    private readonly queue: Queue,
  ) {
    super();
  }

  async generate(
    clerkId: string,
    body: {
      cvId: string;
      analysisId?: string;
      jobTitle: string;
      companyName: string;
      jobDescription: string;
    },
  ) {
    // TODO: check subscription limit via BillingService
    const letter = this.repo.create({
      jobTitle: body.jobTitle,
      companyName: body.companyName,
      content: '',
      status: 'draft',
    });
    const saved = await this.repo.save(letter);
    await this.queue.add('generate-letter', {
      coverLetterId: saved.id,
      cvId: body.cvId,
      analysisId: body.analysisId,
      jobDescription: body.jobDescription,
    });
    return saved;
  }

  async process(
    job: Job<{ coverLetterId: string; cvId: string; analysisId?: string; jobDescription: string }>,
  ): Promise<void> {
    const { coverLetterId } = job.data;
    this.logger.log(`Generating cover letter ${coverLetterId}`);

    try {
      // TODO: fetch CV text, call AIService with temperature 0.7
      // TODO: validate generated letter is not empty and not verbatim CV sentences
      const content = 'TODO: AI-generated cover letter content';
      await this.repo.update(coverLetterId, { content, status: 'generated' });
    } catch (err) {
      this.logger.error(`Cover letter ${coverLetterId} generation failed`, err);
    }
  }

  async listForUser(_clerkId: string) {
    return this.repo.find({ order: { createdAt: 'DESC' } });
  }

  async update(_clerkId: string, id: string, content: string) {
    await this.repo.update(id, { content });
    return this.repo.findOneByOrFail({ id });
  }

  async getDownloadUrl(_clerkId: string, _id: string, _format: 'pdf' | 'docx') {
    // TODO: generate file from content, upload to R2, return presigned GET URL
    return { downloadUrl: 'TODO' };
  }
}
