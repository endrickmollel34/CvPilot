import { IsIn } from 'class-validator';

import type { TemplateId } from '@cvpilot/shared';
import { TEMPLATE_REGISTRY } from '@cvpilot/shared';

// Derived from the shared registry rather than a hardcoded list, so a
// newly-registered template becomes selectable here automatically — no
// second list to keep in sync as more templates are added.
const VALID_TEMPLATE_IDS = Object.keys(TEMPLATE_REGISTRY) as TemplateId[];

export class UpdateCvTemplateDto {
  @IsIn(VALID_TEMPLATE_IDS)
  templateId!: TemplateId;
}
