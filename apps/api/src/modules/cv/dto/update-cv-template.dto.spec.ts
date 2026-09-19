import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { UpdateCvTemplateDto } from './update-cv-template.dto';

// Regression coverage for a production incident: this DTO's
// VALID_TEMPLATE_IDS is derived from TEMPLATE_REGISTRY (@cvpilot/shared) so
// it can never silently fall behind as templates are added — but a stale
// production deploy (an API container still running an older build of
// @cvpilot/shared, from before Minimal/Professional/Compact/Signature were
// registered) reproduced exactly the symptom a hardcoded two-value list
// would: PATCH /cvs/:id/template rejected every id except "classic"/
// "modern" with "templateId must be one of the following values: classic,
// modern". These tests pin down, at the source level, that every one of
// the six currently-shipped templates validates successfully and that an
// unknown id is still rejected — so a future regression here (hardcoding
// this list again, or a template silently dropped from the registry) fails
// a test instead of only surfacing in production.
describe('UpdateCvTemplateDto', () => {
  it.each(['classic', 'modern', 'minimal', 'professional', 'compact', 'signature', 'profile'])(
    'accepts "%s" (a real, registered template id)',
    async (templateId) => {
      const dto = plainToInstance(UpdateCvTemplateDto, { templateId });
      expect(await validate(dto)).toHaveLength(0);
    },
  );

  it('rejects an unrecognized templateId', async () => {
    const dto = plainToInstance(UpdateCvTemplateDto, { templateId: 'random' });
    const errors = await validate(dto);
    expect(errors).not.toHaveLength(0);
    expect(errors[0]?.property).toBe('templateId');
  });

  it('rejects a missing templateId', async () => {
    const dto = plainToInstance(UpdateCvTemplateDto, {});
    expect(await validate(dto)).not.toHaveLength(0);
  });
});
