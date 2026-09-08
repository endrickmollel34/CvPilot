// CV Template Foundation, Phase 1 — verifies the shared template registry's
// resolution logic (@cvpilot/shared has no test runner of its own; these
// are exactly the functions PdfGenerationService/CvEntity rely on for
// "existing CVs safely default to Classic").
import {
  CLASSIC_TEMPLATE,
  MODERN_TEMPLATE,
  MINIMAL_TEMPLATE,
  PROFESSIONAL_TEMPLATE,
  COMPACT_TEMPLATE,
  SIGNATURE_TEMPLATE,
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

  // CV Template Foundation, Phase 3 — Minimal
  it('resolves "minimal" to MINIMAL_TEMPLATE', () => {
    expect(getTemplate('minimal')).toBe(MINIMAL_TEMPLATE);
    expect(isValidTemplateId('minimal')).toBe(true);
  });

  it('Minimal is single-column and tiered ats-friendly-visual (no sidebar, no photo, still has typography personality)', () => {
    expect(MINIMAL_TEMPLATE.layout).toBe('single-column');
    expect(MINIMAL_TEMPLATE.sidebarSections).toBeUndefined();
    expect(MINIMAL_TEMPLATE.atsTier).toBe('ats-friendly-visual');
  });

  it('Minimal uses more generous spacing and margins than both Classic and Modern', () => {
    expect(MINIMAL_TEMPLATE.spacing.sectionGap).toBeGreaterThan(
      CLASSIC_TEMPLATE.spacing.sectionGap,
    );
    expect(MINIMAL_TEMPLATE.spacing.sectionGap).toBeGreaterThan(MODERN_TEMPLATE.spacing.sectionGap);
    expect(MINIMAL_TEMPLATE.margins.left).toBeGreaterThan(CLASSIC_TEMPLATE.margins.left);
    expect(MINIMAL_TEMPLATE.margins.left).toBeGreaterThan(MODERN_TEMPLATE.margins.left);
  });

  it("Minimal does not reuse Modern's teal accent color", () => {
    expect(MINIMAL_TEMPLATE.colors.accent.toLowerCase()).not.toBe(
      MODERN_TEMPLATE.colors.accent.toLowerCase(),
    );
  });

  // CV Template Foundation, Phase 4 — Professional
  it('resolves "professional" to PROFESSIONAL_TEMPLATE', () => {
    expect(getTemplate('professional')).toBe(PROFESSIONAL_TEMPLATE);
    expect(isValidTemplateId('professional')).toBe(true);
  });

  it('Professional uses the sidebar-main layout shape but is dispatched by id, not layout, so it never collides with Modern', () => {
    expect(PROFESSIONAL_TEMPLATE.layout).toBe('sidebar-main');
    expect(MODERN_TEMPLATE.layout).toBe('sidebar-main');
    expect(PROFESSIONAL_TEMPLATE.id).not.toBe(MODERN_TEMPLATE.id);
  });

  it('Professional is tiered visual-professional (two-column layout), not ats-first', () => {
    expect(PROFESSIONAL_TEMPLATE.atsTier).toBe('visual-professional');
  });

  it("Professional defines its own header-band tokens, distinct from Modern's and Minimal's accent colors", () => {
    expect(PROFESSIONAL_TEMPLATE.colors.headerBackground).toBeDefined();
    expect(PROFESSIONAL_TEMPLATE.colors.headerText).toBeDefined();
    expect(PROFESSIONAL_TEMPLATE.colors.accent.toLowerCase()).not.toBe(
      MODERN_TEMPLATE.colors.accent.toLowerCase(),
    );
    expect(PROFESSIONAL_TEMPLATE.colors.accent.toLowerCase()).not.toBe(
      MINIMAL_TEMPLATE.colors.accent.toLowerCase(),
    );
    // Every other template leaves the header-band tokens undefined — only
    // Professional has a colored header band.
    expect(CLASSIC_TEMPLATE.colors.headerBackground).toBeUndefined();
    expect(MODERN_TEMPLATE.colors.headerBackground).toBeUndefined();
    expect(MINIMAL_TEMPLATE.colors.headerBackground).toBeUndefined();
  });

  it("Professional does not use a tinted secondary column (unlike Modern's sidebarBackground)", () => {
    expect(PROFESSIONAL_TEMPLATE.sidebarBackground).toBeUndefined();
  });

  // CV Template Foundation, Phase 5 — Compact
  it('resolves "compact" to COMPACT_TEMPLATE', () => {
    expect(getTemplate('compact')).toBe(COMPACT_TEMPLATE);
    expect(isValidTemplateId('compact')).toBe(true);
  });

  it('Compact is single-column, not sidebar-main, despite reusing the sidebarSections field', () => {
    expect(COMPACT_TEMPLATE.layout).toBe('single-column');
    expect(COMPACT_TEMPLATE.layout).not.toBe('sidebar-main');
    expect(COMPACT_TEMPLATE.atsTier).toBe('ats-friendly-visual');
  });

  it('Compact repurposes sidebarSections to mark the horizontal footer band, not a persistent side column', () => {
    expect(COMPACT_TEMPLATE.sidebarSections).toEqual(['skills', 'languages', 'certifications']);
  });

  it('Compact has no header-band tokens (unlike Professional) and no tinted sidebar (unlike Modern)', () => {
    expect(COMPACT_TEMPLATE.colors.headerBackground).toBeUndefined();
    expect(COMPACT_TEMPLATE.colors.headerText).toBeUndefined();
    expect(COMPACT_TEMPLATE.sidebarBackground).toBeUndefined();
  });

  it('Compact has its own fifth heading treatment, distinct from every other template', () => {
    expect(COMPACT_TEMPLATE.headingTreatment).toBe('copper-marker-inline-rule');
    expect(COMPACT_TEMPLATE.headingTreatment).not.toBe(CLASSIC_TEMPLATE.headingTreatment);
    expect(COMPACT_TEMPLATE.headingTreatment).not.toBe(MODERN_TEMPLATE.headingTreatment);
    expect(COMPACT_TEMPLATE.headingTreatment).not.toBe(MINIMAL_TEMPLATE.headingTreatment);
    expect(COMPACT_TEMPLATE.headingTreatment).not.toBe(PROFESSIONAL_TEMPLATE.headingTreatment);
  });

  it("Compact does not reuse another template's accent color", () => {
    expect(COMPACT_TEMPLATE.colors.accent.toLowerCase()).not.toBe(
      MODERN_TEMPLATE.colors.accent.toLowerCase(),
    );
    expect(COMPACT_TEMPLATE.colors.accent.toLowerCase()).not.toBe(
      MINIMAL_TEMPLATE.colors.accent.toLowerCase(),
    );
    expect(COMPACT_TEMPLATE.colors.accent.toLowerCase()).not.toBe(
      PROFESSIONAL_TEMPLATE.colors.accent.toLowerCase(),
    );
  });

  it('Compact uses the tightest spacing/margins of any template (its density comes from spacing, not just smaller fonts)', () => {
    expect(COMPACT_TEMPLATE.spacing.sectionGap).toBeLessThan(CLASSIC_TEMPLATE.spacing.sectionGap);
    expect(COMPACT_TEMPLATE.spacing.sectionGap).toBeLessThan(MINIMAL_TEMPLATE.spacing.sectionGap);
    expect(COMPACT_TEMPLATE.spacing.sectionGap).toBeLessThan(MODERN_TEMPLATE.spacing.sectionGap);
    expect(COMPACT_TEMPLATE.spacing.sectionGap).toBeLessThan(
      PROFESSIONAL_TEMPLATE.spacing.sectionGap,
    );
    expect(COMPACT_TEMPLATE.margins.left).toBeLessThanOrEqual(CLASSIC_TEMPLATE.margins.left);
  });

  // CV Template Foundation, Phase 6 — Signature
  it('resolves "signature" to SIGNATURE_TEMPLATE', () => {
    expect(getTemplate('signature')).toBe(SIGNATURE_TEMPLATE);
    expect(isValidTemplateId('signature')).toBe(true);
  });

  it('Signature is single-column and honestly tiered visual-professional, not ats-first/ats-friendly', () => {
    expect(SIGNATURE_TEMPLATE.layout).toBe('single-column');
    expect(SIGNATURE_TEMPLATE.atsTier).toBe('visual-professional');
  });

  it('Signature repurposes sidebarSections a third way — a detail-panel row set, not a column or a band', () => {
    expect(SIGNATURE_TEMPLATE.sidebarSections).toEqual(['skills', 'languages', 'certifications']);
  });

  it('Signature has its own sixth heading treatment, distinct from every other template', () => {
    expect(SIGNATURE_TEMPLATE.headingTreatment).toBe('wine-tick-label');
    expect(SIGNATURE_TEMPLATE.headingTreatment).not.toBe(CLASSIC_TEMPLATE.headingTreatment);
    expect(SIGNATURE_TEMPLATE.headingTreatment).not.toBe(MODERN_TEMPLATE.headingTreatment);
    expect(SIGNATURE_TEMPLATE.headingTreatment).not.toBe(MINIMAL_TEMPLATE.headingTreatment);
    expect(SIGNATURE_TEMPLATE.headingTreatment).not.toBe(PROFESSIONAL_TEMPLATE.headingTreatment);
    expect(SIGNATURE_TEMPLATE.headingTreatment).not.toBe(COMPACT_TEMPLATE.headingTreatment);
  });

  it("Signature does not reuse another template's accent color", () => {
    expect(SIGNATURE_TEMPLATE.colors.accent.toLowerCase()).not.toBe(
      MODERN_TEMPLATE.colors.accent.toLowerCase(),
    );
    expect(SIGNATURE_TEMPLATE.colors.accent.toLowerCase()).not.toBe(
      MINIMAL_TEMPLATE.colors.accent.toLowerCase(),
    );
    expect(SIGNATURE_TEMPLATE.colors.accent.toLowerCase()).not.toBe(
      PROFESSIONAL_TEMPLATE.colors.accent.toLowerCase(),
    );
    expect(SIGNATURE_TEMPLATE.colors.accent.toLowerCase()).not.toBe(
      COMPACT_TEMPLATE.colors.accent.toLowerCase(),
    );
  });

  it('Signature avoids the disallowed color families (navy, teal, copper/orange)', () => {
    // Explicit product constraint: no navy (Professional), no teal
    // (Modern), no copper/orange (Compact).
    expect(SIGNATURE_TEMPLATE.colors.accent.toLowerCase()).not.toBe(
      PROFESSIONAL_TEMPLATE.colors.heading.toLowerCase(),
    );
    expect(SIGNATURE_TEMPLATE.colors.accent.toLowerCase()).not.toBe(
      MODERN_TEMPLATE.colors.heading.toLowerCase(),
    );
    expect(SIGNATURE_TEMPLATE.colors.accent.toLowerCase()).not.toBe(
      COMPACT_TEMPLATE.colors.accent.toLowerCase(),
    );
  });

  it("Signature reuses headerBackground for a small header card, never a full-bleed band like Professional's", () => {
    expect(SIGNATURE_TEMPLATE.colors.headerBackground).toBeDefined();
    // Signature deliberately leaves headerText/headerMutedText undefined —
    // unlike Professional, it never inverts text color onto a dark band.
    expect(SIGNATURE_TEMPLATE.colors.headerText).toBeUndefined();
    expect(SIGNATURE_TEMPLATE.sidebarBackground).toBeUndefined();
  });

  it('Signature has the largest base name size of any template', () => {
    expect(SIGNATURE_TEMPLATE.typography.nameSize).toBeGreaterThan(
      CLASSIC_TEMPLATE.typography.nameSize,
    );
    expect(SIGNATURE_TEMPLATE.typography.nameSize).toBeGreaterThan(
      MODERN_TEMPLATE.typography.nameSize,
    );
    expect(SIGNATURE_TEMPLATE.typography.nameSize).toBeGreaterThan(
      MINIMAL_TEMPLATE.typography.nameSize,
    );
    expect(SIGNATURE_TEMPLATE.typography.nameSize).toBeGreaterThan(
      PROFESSIONAL_TEMPLATE.typography.nameSize,
    );
    expect(SIGNATURE_TEMPLATE.typography.nameSize).toBeGreaterThan(
      COMPACT_TEMPLATE.typography.nameSize,
    );
  });

  it('DEFAULT_TEMPLATE_ID points at a real, registered template', () => {
    expect(TEMPLATE_REGISTRY[DEFAULT_TEMPLATE_ID]).toBeDefined();
    expect(isValidTemplateId(DEFAULT_TEMPLATE_ID)).toBe(true);
  });

  it('isValidTemplateId rejects unknown ids', () => {
    expect(isValidTemplateId('nonexistent')).toBe(false);
  });
});
