import { IsObject } from 'class-validator';

import type { CvContent } from '@cvpilot/shared';

export class UpdateCvContentDto {
  @IsObject()
  content!: CvContent;
}
