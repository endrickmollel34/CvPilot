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

export type TemplateId =
  | 'classic'
  | 'modern'
  | 'minimal'
  | 'professional'
  | 'compact'
  | 'signature';

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
 *  meaningful together with `sidebarSections` — see its doc comment.
 *  Compact is 'single-column' even though it ALSO uses `sidebarSections`
 *  (repurposed to mark which sections render in its horizontal footer
 *  band rather than a side column — see its own doc comment) — there is
 *  no persistent second column that must survive a page break, so it
 *  never needs 'sidebar-main''s two-cursor machinery. */
export type TemplateLayout = 'single-column' | 'sidebar-main';

/** 'accent-underline' (Modern): heading text itself is set in the accent
 *  color, medium weight, with a short accent-colored rule beneath it —
 *  more expressive than Classic's 'rule-underline' (full-width thin gray
 *  line above a small uppercase label), appropriate for a template that
 *  doesn't need to look conservative. */
/** 'editorial-label' (Minimal): heading text in normal/title case (never
 *  uppercase), moderate weight, refined letter-spacing, no rule at all —
 *  the section break itself is communicated by generous whitespace
 *  (spacing.sectionGap) rather than a drawn line or color, distinct from
 *  both Classic's rule-above-caps and Modern's colored rule-below.
 *  'navy-caps-rule' (Professional): heading text IS uppercase (like
 *  Classic) but set in the navy accent color at a more confident size,
 *  with a short navy rule below it (like Modern's underline mechanic,
 *  but navy + uppercase instead of teal + title-case) — a restrained
 *  corporate "tab" mark, not a full-width line and not colored body
 *  text.
 *  'copper-marker-inline-rule' (Compact): a fifth, genuinely distinct
 *  mechanic — a small copper square sits to the LEFT of the (normal-
 *  case, charcoal, not accent-colored) heading label, and a hairline
 *  gray rule fills the REST of that same line to its right. Every prior
 *  treatment puts its rule (if any) on its own line, above or below the
 *  label; Compact's rule shares the label's own row — a small, literal
 *  expression of the template's "horizontal organization" identity.
 *  'wine-tick-label' (Signature): a sixth, genuinely distinct mechanic —
 *  a short vertical wine bar sits to the LEFT of an uppercase, tracked
 *  CHARCOAL (not wine) label, and — unlike every prior treatment —
 *  there is NO rule at all, drawn or inline. The section break is
 *  communicated by the tick mark plus generous surrounding whitespace,
 *  the same quiet mechanism used again (in miniature) on Signature's
 *  continuation-page header, so the tick reads as the template's one
 *  consistent signature mark rather than a one-off. Deliberately keeps
 *  the accent OFF the label text itself — see SIGNATURE_TEMPLATE's doc
 *  comment on controlled accent usage. */
export type HeadingTreatment =
  | 'rule-underline'
  | 'accent-underline'
  | 'color-band'
  | 'plain'
  | 'editorial-label'
  | 'navy-caps-rule'
  | 'copper-marker-inline-rule'
  | 'wine-tick-label';

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
  /** Professional: full-bleed header band background — the name/title/
   *  contact block renders on top of this color instead of the page's
   *  plain white. Signature reuses the SAME field for a deliberately
   *  smaller, quieter purpose — a small tinted "card" region behind only
   *  its header's secondary contact zone, never full-bleed and never
   *  behind the candidate name — see SIGNATURE_TEMPLATE's doc comment
   *  for why that reuse doesn't collapse the two templates' identities
   *  into each other. Undefined for every other template (no tinted
   *  region at all). */
  headerBackground?: string;
  /** Candidate-name color when rendered on `headerBackground` — normally
   *  white or near-white. Falls back to `text` when undefined. */
  headerText?: string;
  /** Job-title/contact color when rendered on `headerBackground` — a
   *  softened/muted white so the name still reads as the clear visual
   *  peak of the header. Falls back to `muted` when undefined. */
  headerMutedText?: string;
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
  /** For `layout === 'sidebar-main'` (Modern, Professional): the sections
   *  rendered in the narrower sidebar column, in their sectionOrder-
   *  relative order; every other section renders in the main column, also
   *  in their sectionOrder-relative order. A fixed column ASSIGNMENT per
   *  section (not a per-CV choice) — this partitions the same factual
   *  content spatially, never drops or duplicates a section.
   *  Compact (`layout === 'single-column'`) repurposes this same field
   *  for a different structural idea: these sections render together, in
   *  one pass, as a single horizontal multi-column footer band (not a
   *  persistent side column) — see compact-document.tsx / the PDFKit
   *  renderer's own doc comment. Signature (`layout === 'single-column'`)
   *  repurposes it a third way: these sections render together, after
   *  the main narrative, as label:value rows inside one framed "detail
   *  panel" (see signature-document.tsx's `DetailPanel` doc comment) —
   *  a third distinct structural treatment of the same "which sections
   *  are secondary" concept, chosen over adding a fourth field. */
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

/**
 * Minimal (Phase 3, V1) — a genuinely distinct third design: single-
 * column, editorial "quiet luxury". Gets its personality entirely from
 * typography, whitespace, and proportion rather than color or structure —
 * no sidebar, no tinted regions, no chips/bars/icons. Near-monochrome
 * charcoal/warm-gray palette with exactly ONE restrained accent (a muted
 * warm taupe, `colors.accent`), used sparingly: the header's single
 * hairline rule, and the organization/institution line in Experience/
 * Education entries — never Modern's teal identity, never Classic's
 * uppercase rule-underline headings (see `headingTreatment` above).
 *
 * Every spacing token (sectionGap/entryGap/bulletGap/lineGap) and every
 * margin is deliberately larger than BOTH Classic's and Modern's — see
 * the module report's "Whitespace + density" brief — so Minimal reads as
 * more spacious without needing a different structural mechanism (no
 * sidebar tint, no forced page count) to justify it.
 */
export const MINIMAL_TEMPLATE: TemplateDefinition = {
  id: 'minimal',
  name: 'Minimal',
  description: 'Elegant, editorial single-column design with premium spacing and typography.',
  atsTier: 'ats-friendly-visual',
  layout: 'single-column',
  headingTreatment: 'editorial-label',
  typography: {
    fontFamily: 'Liberation Sans, Arial, Helvetica, sans-serif',
    nameSize: 32,
    jobTitleSize: 12.5,
    headingSize: 12,
    bodySize: 10.5,
    metaSize: 9,
  },
  colors: {
    text: '#211F1C',
    heading: '#211F1C',
    muted: '#6E6860',
    rule: '#E1DCD3',
    accent: '#8A6F4E',
  },
  spacing: {
    sectionGap: 24,
    entryGap: 18,
    bulletGap: 5,
    lineGap: 3,
  },
  margins: {
    top: 58,
    bottom: 58,
    left: 58,
    right: 58,
  },
};

/**
 * Professional (Phase 4, V1) — a genuinely distinct fourth design: premium
 * corporate, built for senior professionals (consultants, PMs, finance,
 * executives). Its signature is a full-bleed navy header band (name in
 * white, title/contact in softened white) — no template before it uses a
 * colored background anywhere on the page. Below the band, a white body
 * in an asymmetric ~65/35 split: Summary/Experience/Education in the
 * dominant main column, Expertise/Languages/Certifications in a narrower
 * secondary column.
 *
 * Deliberately does NOT reuse Modern's tinted-sidebar mechanic for the
 * secondary column — a second full-height colored region would blur
 * Professional's identity into Modern's. Instead the secondary column
 * stays plain white/near-white and is differentiated by a thin vertical
 * rule, tighter typography, and the same navy section-heading accent
 * used in the main column — spacing and restraint do the work, not
 * color. `sidebarBackground` is deliberately left undefined for exactly
 * this reason.
 *
 * `headingTreatment: 'navy-caps-rule'` — uppercase navy heading text (not
 * Minimal's title-case, not Modern's teal) with a short navy rule below
 * (not Classic's full-width rule above), so it can't be mistaken for
 * either sibling template. `layout: 'sidebar-main'` describes the same
 * structural shape as Modern (full-width header, then two columns) —
 * apps/api's pdf-generation.service.ts dispatches by `id`, not `layout`,
 * so this never collides with Modern's own renderer.
 */
export const PROFESSIONAL_TEMPLATE: TemplateDefinition = {
  id: 'professional',
  name: 'Professional',
  description: 'Premium corporate design with a navy header band, built for senior professionals.',
  atsTier: 'visual-professional',
  layout: 'sidebar-main',
  headingTreatment: 'navy-caps-rule',
  typography: {
    fontFamily: 'Liberation Sans, Arial, Helvetica, sans-serif',
    nameSize: 27,
    jobTitleSize: 13,
    headingSize: 11.5,
    bodySize: 10.2,
    metaSize: 8.5,
  },
  colors: {
    text: '#202428',
    heading: '#17324D',
    muted: '#66717C',
    rule: '#D9DFE4',
    accent: '#17324D',
    headerBackground: '#17324D',
    headerText: '#FFFFFF',
    headerMutedText: '#C9D3DC',
  },
  spacing: {
    sectionGap: 16,
    entryGap: 12,
    bulletGap: 4,
    lineGap: 2.5,
  },
  margins: {
    top: 42,
    bottom: 48,
    left: 50,
    right: 50,
  },
  sidebarSections: ['skills', 'languages', 'certifications'],
  sidebarWidthRatio: 0.35,
};

/**
 * Compact (Phase 5, V1) — a genuinely distinct fifth design, for
 * candidates with substantial content who want efficient page-space use
 * without sacrificing readability. Deliberately NOT "Minimal with smaller
 * fonts": its density comes from tighter spacing tokens (every one of
 * them the tightest of any template — see each token's own comment for
 * the practical readability floor it was tuned against) and, more
 * importantly, from ONE structural idea none of the other four use —
 * Skills/Languages/Certifications render as a single horizontal, multi-
 * column footer band (see `sidebarSections`' doc comment) rather than
 * three separately-headed stacked sections. Each present section still
 * gets its own heading, but the band's combined vertical footprint is the
 * height of its TALLEST column, not the SUM of three stacked sections'
 * heights, and the gap before the band is paid once instead of three
 * times.
 *
 * Single column throughout (no side column, no tinted region, no photo,
 * no icons) — Summary, Experience, and Education flow full-width, then
 * the footer band. `headingTreatment: 'copper-marker-inline-rule'` is a
 * fifth, genuinely distinct mechanic (see its own doc comment). The
 * muted copper accent (`colors.accent`) is used sparingly, in exactly
 * two places: the header's short rule and each heading's small square
 * marker — organization/institution lines are bold charcoal, not
 * accent-colored, unlike every sidebar-having template before it.
 */
export const COMPACT_TEMPLATE: TemplateDefinition = {
  id: 'compact',
  name: 'Compact',
  description:
    'Efficient single-column design for content-rich CVs, without sacrificing readability.',
  atsTier: 'ats-friendly-visual',
  layout: 'single-column',
  headingTreatment: 'copper-marker-inline-rule',
  typography: {
    fontFamily: 'Liberation Sans, Arial, Helvetica, sans-serif',
    // "Prominent but not oversized" — smaller than every other
    // template's name (Classic 22 is the next smallest) since Compact's
    // whole identity is efficiency, not a typographic centerpiece.
    nameSize: 19,
    jobTitleSize: 10.5,
    // 9.5pt is treated as the practical floor for a section label at
    // normal viewing distance — Compact's heading is already the
    // smallest of any template; going smaller risked it reading as
    // disabled/low-emphasis rather than "compact".
    headingSize: 9.5,
    // 9.3pt is treated as the practical floor for printed body copy —
    // deliberately NOT pushed lower purely to cram in more content (see
    // the module report's density brief: density comes from spacing,
    // not from shrinking text past comfortable reading size).
    bodySize: 9.3,
    // 7.8pt is treated as the practical floor for secondary/meta text
    // (dates, issuer/date lines) — still comfortably legible printed.
    metaSize: 7.8,
  },
  colors: {
    text: '#2A2826',
    heading: '#1E1C1A',
    muted: '#726C66',
    rule: '#E4E1DD',
    accent: '#AE6239',
  },
  spacing: {
    // Every value here is the tightest of any template (compare Classic
    // 14/10/3/2, Modern 16/12/4/2.5, Minimal 24/18/5/3, Professional
    // 16/12/4/2.5) — this, not font size, is Compact's real density
    // lever. bulletGap/lineGap floors were chosen so consecutive lines
    // never look glued together even at these tighter values.
    sectionGap: 11,
    entryGap: 7,
    bulletGap: 2.5,
    lineGap: 1.5,
  },
  margins: {
    // 32pt is treated as the practical floor for an A4 margin (typical
    // consumer printers can't reliably print closer to the edge) —
    // Compact's margins sit at or just above that floor, tighter than
    // every other template (Modern 46, Professional 42-50, Classic 54,
    // Minimal 58) to maximize usable width/height.
    top: 34,
    bottom: 36,
    left: 40,
    right: 40,
  },
  // Repurposed for Compact's horizontal footer band, not a side column —
  // see this field's own doc comment above and compact-document.tsx.
  sidebarSections: ['skills', 'languages', 'certifications'],
};

/**
 * Signature (Phase 6, V1) — the sixth and final design in CVPilot's
 * initial collection: editorial, sophisticated, premium. Aimed at
 * designers, architects, consultants, brand/marketing professionals,
 * strategists, founders, and senior/creative professionals who still
 * need a serious, extraction-safe CV — not a poster, infographic, or
 * portfolio page.
 *
 * Identity comes from THREE mechanics none of the other five combine:
 *
 * 1. An asymmetric two-zone header (`layout: 'single-column'` — this
 *    split exists ONLY across the header row, not the whole page, so it
 *    never collapses into Modern's/Professional's persistent
 *    `sidebar-main` column that must survive a page break). The left
 *    zone carries the job title as a small tracked wine "eyebrow" ABOVE
 *    the name (every other template puts the title below/after the
 *    name), then the large name, then a short wine rule directly under
 *    it. The right zone is a small, deliberately non-full-bleed tinted
 *    card (`colors.headerBackground`, reused from Professional's field
 *    but at a fraction of the size and never behind the name — see that
 *    field's own doc comment) holding the contact details. A full-width
 *    hairline rule closes the header before the body starts.
 * 2. `headingTreatment: 'wine-tick-label'` — a sixth, genuinely distinct
 *    mechanic (see its own doc comment): a vertical wine tick beside an
 *    uppercase CHARCOAL label, no rule at all.
 * 3. A "detail panel" for Skills/Languages/Certifications (see
 *    `sidebarSections`'s doc comment and signature-document.tsx's
 *    `DetailPanel`) — present sections become label:value rows framed
 *    by one top and one bottom hairline rule, never Modern's/
 *    Professional's persistent sidebar column and never Compact's
 *    horizontal three-column footer band.
 *
 * Controlled accent usage (explicit product requirement — the wine
 * accent must read as mature and expensive, never decorative): wine
 * appears in exactly three places — the eyebrow job title, the short
 * rule under the name, and each heading's tick mark — plus the
 * organization/institution line in Experience/Education entries (the
 * one place every accent-having template before it also colors, for a
 * consistent cross-template convention). Section/row LABELS, dates, and
 * body copy are never wine.
 *
 * Typography floors (documented per the product brief's explicit
 * requirement): name 34pt base / 24pt floor (adaptive, see
 * `useSignatureNameFontSize`), heading 11.5pt, body 10.4pt (never
 * shrunk to force one page — see the module report's pagination
 * section), meta 8.6pt.
 */
export const SIGNATURE_TEMPLATE: TemplateDefinition = {
  id: 'signature',
  name: 'Signature',
  description:
    'Editorial, sophisticated premium design with a restrained wine accent, for senior and creative professionals.',
  atsTier: 'visual-professional',
  layout: 'single-column',
  headingTreatment: 'wine-tick-label',
  typography: {
    fontFamily: 'Liberation Sans, Arial, Helvetica, sans-serif',
    // Largest name of any template — "may be larger... if the layout
    // supports it" (product brief). Adaptive floor (see
    // useSignatureNameFontSize/signatureNameFontSize) stays at 24pt —
    // still larger than Classic's entire 22pt base name size — so even
    // the longest realistic name reads as the unmistakable visual peak
    // of the page.
    nameSize: 34,
    // Doubles as the header "eyebrow" size — small and tracked, but not
    // pushed below comfortable label size since it is real, load-bearing
    // job-title text, not a decorative kicker.
    jobTitleSize: 11,
    // 11.5pt treated as the practical floor for a section label rendered
    // in uppercase with letter-spacing — uppercase tracked text reads
    // smaller than mixed-case at the same size, so this sits above
    // Professional's 11.5 rather than below it.
    headingSize: 11.5,
    // 10.4pt treated as the practical floor for comfortable printed body
    // copy in an editorial layout with generous line-height — never
    // shrunk further purely to force single-page fit (see the module
    // report's pagination section).
    bodySize: 10.4,
    // 8.6pt treated as the practical floor for secondary/meta text
    // (dates, issuer/date lines, contact details) — still comfortably
    // legible printed at typical CV viewing distance.
    metaSize: 8.6,
  },
  colors: {
    text: '#343033',
    heading: '#272326',
    muted: '#756D70',
    rule: '#DDD6D8',
    // Mature wine, not romantic/decorative — deliberately darker/more
    // desaturated than a "burgundy" that reads as red. See the module
    // report's controlled-accent-usage brief for exactly where this is
    // (and is not) used.
    accent: '#7A3045',
    // Very subtle warm surface — used ONLY behind the header's small
    // contact card (never full-bleed, never behind the name) — see this
    // field's own doc comment for why reusing it doesn't collapse into
    // Professional's identity.
    headerBackground: '#F7F3F2',
  },
  spacing: {
    sectionGap: 18,
    entryGap: 13,
    bulletGap: 4,
    lineGap: 2.6,
  },
  margins: {
    top: 50,
    bottom: 52,
    left: 52,
    right: 52,
  },
  // Reused a third way — see this field's own doc comment: Signature's
  // detail-panel row set, not a side column or a horizontal band.
  sidebarSections: ['skills', 'languages', 'certifications'],
};

export const TEMPLATE_REGISTRY: Record<TemplateId, TemplateDefinition> = {
  classic: CLASSIC_TEMPLATE,
  modern: MODERN_TEMPLATE,
  minimal: MINIMAL_TEMPLATE,
  professional: PROFESSIONAL_TEMPLATE,
  compact: COMPACT_TEMPLATE,
  signature: SIGNATURE_TEMPLATE,
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
