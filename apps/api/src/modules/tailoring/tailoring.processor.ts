import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';

import { TailoringService } from './tailoring.service';

@Processor('cv-tailoring')
export class TailoringProcessor extends WorkerHost {
  constructor(private readonly tailoringService: TailoringService) {
    super();
  }

  async process(job: Job<{ tailoringId: string }>): Promise<void> {
    await this.tailoringService.runTailoring(job.data.tailoringId);
  }
}
