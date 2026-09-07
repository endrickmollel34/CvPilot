// CV Template Foundation, Phase 1 — verifies the shared template registry's
// resolution logic (@cvpilot/shared has no test runner of its own; these
// are exactly the functions PdfGenerationService/CvEntity rely on for
// "existing CVs safely default to Classic").
import {
  CLASSIC_TEMPLATE,
  MODERN_TEMPLATE,
  DEFAULT_TEMPLATE_ID,
  TEMPLATE_REGISTRY,
  getTemplate,
  isValidTemplateId,
} from '@cvpilot/shared';

describe('shared template registry', () => {
  it('defaults to Classic for a missing/undefined templateId (existing CVs pre-dating the column)', () => {
    expect(getTemplate(undefined)).toBe(CLASSIC_TEMPLATE);
    expect(getTemplate(null)).toBe(CLASSIC_TEMPLATE);
  });

  it('defaults to Classic for an unrecognized templateId rather than throwing', () => {
    expect(getTemplate('some-future-removed-template')).toBe(CLASSIC_TEMPLATE);
  });

  it('resolves a valid templateId to its own definition', () => {
    expect(getTemplate('classic')).toBe(CLASSIC_TEMPLATE);
  });

  // CV Template Foundation, Phase 2 — Modern
  it('resolves "modern" to MODERN_TEMPLATE', () => {
    expect(getTemplate('modern')).toBe(MODERN_TEMPLATE);
    expect(isValidTemplateId('modern')).toBe(true);
  });

  it('Modern is honestly tiered visual-professional (two-column layout), not ats-first', () => {
    expect(MODERN_TEMPLATE.layout).toBe('sidebar-main');
    expect(MODERN_TEMPLATE.atsTier).toBe('visual-professional');
    expect(CLASSIC_TEMPLATE.atsTier).toBe('ats-first');
  });

  it('DEFAULT_TEMPLATE_ID points at a real, registered template', () => {
    expect(TEMPLATE_REGISTRY[DEFAULT_TEMPLATE_ID]).toBeDefined();
    expect(isValidTemplateId(DEFAULT_TEMPLATE_ID)).toBe(true);
  });

  it('isValidTemplateId rejects unknown ids', () => {
    expect(isValidTemplateId('nonexistent')).toBe(false);
  });
});
