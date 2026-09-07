/**
 * CV Template Foundation (Phase 1) — the smallest typed system that lets a
 * React browser preview and a PDFKit renderer agree on what a template
 * looks like, without either one needing to know the other exists.
 *
 * Deliberately small: this is data (numbers, strings, enums), not a layout
 * engine. Both renderers still implement their own drawing/layout code —
 * see the Template Foundation decision report for why that residual
 * duplication is an accepted, bounded trade-off for a handful of curated
 * templates, not a general design framework. Do not grow this into one.
 *
 * Units: every numeric size (typography, spacing, margins) is in points
 * (pt) — PDFKit's native coordinate unit, and also a real, exact CSS unit
 * (`10pt` in CSS is defined as 1/72 inch, identical to PDFKit's `10`) — so
 * the same numbers drive both renderers with zero unit conversion.
 *
 * Reused later by Cover Letter documents for the same typography/color/
 * spacing/page tokens (not done in this phase — Cover Letter is untouched).
 */

import type { CvSection } from '../types/cv.types';

export type TemplateId = 'classic' | 'modern';

/**
 * Guidance only, never a guarantee — real-world ATS parser behavior varies
 * too much across vendors to promise compatibility. See the CV Template
 * System audit for the full reasoning behind each tier.
 *   - ats-first:          single column, no visual risk elements at all.
 *   - ats-friendly-visual: modest color/typography personality, still no
 *                          structural risk (tables, sidebars, icons-as-labels).
 *   - visual-professional: may use a sidebar and/or a photo — reduced
 *                          confidence, not recommended for ATS-heavy applications.
 *
 * Modern (added Phase 2) uses a genuine two-column body (see TemplateLayout
 * below) — a column split is one of the concrete risk factors named in the
 * CV Template System audit, so it is honestly tiered 'visual-professional'
 * rather than 'ats-friendly-visual', even though it has no photo. Classic
 * remains the only 'ats-first' template.
 */
export type AtsTier = 'ats-first' | 'ats-friendly-visual' | 'visual-professional';

/** 'sidebar-main' renders a full-width header, then two columns: a
 *  narrower sidebar (see `sidebarSections`) and a wider main column. Only
 *  meaningful together with `sidebarSections` — see its doc comment. */
export type TemplateLayout = 'single-column' | 'sidebar-main';

/** 'accent-underline' (Modern): heading text itself is set in the accent
 *  color, medium weight, with a short accent-colored rule beneath it —
 *  more expressive than Classic's 'rule-underline' (full-width thin gray
 *  line above a small uppercase label), appropriate for a template that
 *  doesn't need to look conservative. */
export type HeadingTreatment = 'rule-underline' | 'accent-underline' | 'color-band' | 'plain';

export interface TemplateTypography {
  /** CSS font-family stack (browser) / registered PDFKit font family name —
   *  see classic-document.tsx / pdf-generation.service.ts for how each side
   *  resolves this to an actual font. */
  fontFamily: string;
  nameSize: number;
  jobTitleSize: number;
  headingSize: number;
  bodySize: number;
  metaSize: number;
}

export interface TemplateColors {
  text: string;
  heading: string;
  muted: string;
  rule: string;
  /** Reserved for templates whose headingTreatment actually uses it
   *  (e.g. 'color-band') — Classic's is defined but unused, since Classic
   *  stays deliberately monochrome (see its ATS-first tier). */
  accent: string;
}

export interface TemplateSpacing {
  sectionGap: number;
  entryGap: number;
  bulletGap: number;
  lineGap: number;
}

export interface TemplateMargins {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export interface TemplateDefinition {
  id: TemplateId;
  name: string;
  description: string;
  atsTier: AtsTier;
  layout: TemplateLayout;
  headingTreatment: HeadingTreatment;
  typography: TemplateTypography;
  colors: TemplateColors;
  spacing: TemplateSpacing;
  margins: TemplateMargins;
  /** Only meaningful when `layout === 'sidebar-main'` — the sections
   *  rendered in the narrower sidebar column, in their sectionOrder-
   *  relative order; every other section renders in the main column, also
   *  in their sectionOrder-relative order. A fixed column ASSIGNMENT per
   *  section (not a per-CV choice) — this partitions the same factual
   *  content spatially, never drops or duplicates a section. */
  sidebarSections?: CvSection[];
  /** Fraction (0-1) of the content width the sidebar column occupies when
   *  layout === 'sidebar-main'. */
  sidebarWidthRatio?: number;
  /** Fill color for the sidebar column's background region, spanning the
   *  full page-1 content height regardless of how much sidebar content
   *  there is — makes the sidebar read as a deliberately designed region
   *  rather than text that happens to sit beside the main column, without
   *  needing a bold full-height solid panel. Only meaningful when
   *  layout === 'sidebar-main'. */
  sidebarBackground?: string;
}

export const CLASSIC_TEMPLATE: TemplateDefinition = {
  id: 'classic',
  name: 'Classic',
  description: 'Conservative single-column layout built for maximum ATS compatibility.',
  atsTier: 'ats-first',
  layout: 'single-column',
  headingTreatment: 'rule-underline',
  typography: {
    fontFamily: 'Liberation Sans, Arial, Helvetica, sans-serif',
    nameSize: 22,
    jobTitleSize: 11,
    headingSize: 9,
    bodySize: 10.5,
    metaSize: 9,
  },
  colors: {
    text: '#111827',
    heading: '#374151',
    muted: '#6b7280',
    rule: '#d1d5db',
    accent: '#374151',
  },
  spacing: {
    sectionGap: 14,
    entryGap: 10,
    bulletGap: 3,
    lineGap: 2,
  },
  margins: {
    top: 54,
    bottom: 54,
    left: 54,
    right: 54,
  },
};

/**
 * Modern (Phase 2, revised V2) — an original CVPilot design, not a
 * reproduction of any external reference. A full-width header (name/title/
 * contact) followed by a two-column body: a narrow sidebar (Skills,
 * Languages, Certifications) rendered against a very light teal-tinted
 * background region spanning the full page-1 content height — so it reads
 * as a deliberately designed region rather than text that merely sits
 * beside the main column, without copying a bold full-height solid panel —
 * and a wider main column (Summary, Work Experience, Education). Deep teal
 * accent used purposefully (headings at a confident scale, institution/
 * company names, a short rule under each heading, the sidebar tint itself,
 * skill chips) against a near-black text color.
 *
 * V2 revision: heading size increased (11.5→13.5) for a stronger jump
 * between body text and section titles; `sidebarBackground` added (see
 * TemplateDefinition's doc comment) to solve the "sidebar looks sparse/
 * unfinished when it has little content" problem structurally, rather than
 * by inventing content or artificially stretching spacing.
 *
 * V3 revision: `lineGap`/`bulletGap`/`entryGap` nudged up (2→2.5, 3→4,
 * 11→12) for calmer "editorial" reading rhythm on content-dense CVs —
 * deliberately modest, not a full re-scale, and no font size changed. Font
 * sizes and margins are otherwise unchanged from V2; density on long CVs is
 * now resolved by letting the document run to a genuine, cleanly-designed
 * page 2 (see pdf-generation.service.ts's modern continuation-page
 * behavior) rather than by compressing spacing to force one page.
 */
export const MODERN_TEMPLATE: TemplateDefinition = {
  id: 'modern',
  name: 'Modern',
  description: 'Contemporary two-column design with a tasteful accent color.',
  atsTier: 'visual-professional',
  layout: 'sidebar-main',
  headingTreatment: 'accent-underline',
  typography: {
    fontFamily: 'Liberation Sans, Arial, Helvetica, sans-serif',
    nameSize: 29,
    jobTitleSize: 13,
    headingSize: 13.5,
    bodySize: 10,
    metaSize: 8.5,
  },
  colors: {
    text: '#1F2430',
    heading: '#0E5C56',
    muted: '#5B6570',
    rule: '#D9DEE2',
    accent: '#0E5C56',
  },
  spacing: {
    sectionGap: 16,
    entryGap: 12,
    bulletGap: 4,
    lineGap: 2.5,
  },
  margins: {
    top: 46,
    bottom: 46,
    left: 46,
    right: 46,
  },
  sidebarSections: ['skills', 'languages', 'certifications'],
  sidebarWidthRatio: 0.34,
  sidebarBackground: '#EFF5F4',
};

export const TEMPLATE_REGISTRY: Record<TemplateId, TemplateDefinition> = {
  classic: CLASSIC_TEMPLATE,
  modern: MODERN_TEMPLATE,
};

export const DEFAULT_TEMPLATE_ID: TemplateId = 'classic';

export function isValidTemplateId(id: string): id is TemplateId {
  return Object.prototype.hasOwnProperty.call(TEMPLATE_REGISTRY, id);
}

/** Always resolves to a real definition — an unrecognized id (e.g. stale
 *  data from a template that no longer exists) falls back to the default
 *  rather than throwing, since a CV must always be renderable. */
export function getTemplate(id: string | null | undefined): TemplateDefinition {
  if (id && isValidTemplateId(id)) return TEMPLATE_REGISTRY[id];
  return TEMPLATE_REGISTRY[DEFAULT_TEMPLATE_ID];
}
