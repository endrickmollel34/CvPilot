import { IsArray, IsIn } from 'class-validator';

import type { CvSection } from '@cvpilot/shared';

const VALID_SECTIONS = [
  'summary',
  'workExperience',
  'education',
  'skills',
  'languages',
  'certifications',
] as const;

export class ReorderCvSectionsDto {
  @IsArray()
  @IsIn(VALID_SECTIONS, { each: true })
  sectionOrder!: CvSection[];
}
