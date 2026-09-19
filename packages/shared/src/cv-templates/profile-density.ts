import type { CvContent } from '../types/cv.types';
import { PROFILE_TEMPLATE, type TemplateDefinition } from './template-types';
import { resolveSectionOrder } from './classic-document';

/**
 * Profile's "automatic spacing" system — the single source of truth for how
 * much a given CV's content should nudge Profile's typography/spacing away
 * from PROFILE_TEMPLATE's own baseline tokens, shared verbatim by the
 * browser preview (profile-document.tsx) and the PDFKit renderer
 * (profile-pdf-renderer.ts). Both call `estimateProfileDensity` with the
 * same `CvContent`/`TemplateDefinition` and get the identical tier back —
 * that's what guarantees the preview and the PDF always make the same
 * spacing choice for the same CV, not just a "similar-looking" one.
 *
 * Deliberately NOT based on either renderer's own real measurement
 * (PDFKit's `doc.heightOfString`, the DOM's real layout) — those live in
 * two environments that can't share a call. Instead this estimates wrapped
 * line counts with a portable, deterministic greedy word-wrap (same
 * technique already used by `useProfileNameFontSize`'s canvas-based sizing,
 * minus the canvas — pure arithmetic so it runs identically in Node and the
 * browser) against each column's real width and a fixed set of per-section/
 * per-entry overhead constants approximating this template's own actual
 * heading/entry/row spacing. This is a coarse heuristic for TIER SELECTION
 * only — it is never used to position anything; each renderer still lays
 * out and paginates using its own exact real measurement, so an estimation
 * error here can make the density choice slightly conservative or generous,
 * never cause clipped/overlapping/dropped content.
 */

export type ProfileDensityTier = 'sparse' | 'standard' | 'dense';

export interface ProfileDensityAdjustment {
  tier: ProfileDensityTier;
  /** Added to template.typography.bodySize (pt). */
  bodySizeDelta: number;
  /** Added to template.spacing.sectionGap (pt). */
  sectionGapDelta: number;
  /** Added to template.spacing.entryGap (pt). */
  entryGapDelta: number;
  /** Added to template.spacing.bulletGap (pt). */
  bulletGapDelta: number;
  /** Added to template.spacing.lineGap (pt). */
  lineGapDelta: number;
}

// Bounded, fixed per tier — "moderately tighter... within readable limits"
// means these never scale with content size, only ever apply once.
// Recalibrated 2026-09-17 after comparing this estimator's output against
// profile-pdf-renderer.ts's own real occupied-height instrumentation for
// three real fixtures (the builder's actual "Example CV", the same plus a
// second job, and a genuinely long 10-job/25-skill CV): the sparse tier's
// deltas were previously too subtle to read as a visible change on a
// page that's mostly blank — see estimateProfileFill's own doc comment for
// the matching fix to the estimator's systematic overestimation, which was
// the other half of why the Example CV never reached 'sparse' at all.
// Still bounded/fixed (never scale with content size) and still modest
// relative to PROFILE_TEMPLATE's own baseline (bodySize 10, sectionGap 15,
// entryGap 11, bulletGap 3.5, lineGap 2.2): sparse is now a 15% typography
// swing and a ~45-55% spacing swing — a genuinely visible "roomier" layout
// on an underfilled page, not a cramped/illegible one in the other
// direction (dense) either.
//
// Widened again same day after checking an actual saved, user-edited CV
// (not a synthetic fixture) — the builder's seeded "Example CV" plus a
// photo, two references, and three extra sidebar rows (nationality/
// website/LinkedIn). Its estimated fillRatio (0.501) still landed just
// inside 'standard' under the 0.42 threshold above, leaving ~47% of the
// real rendered page blank with zero adjustment applied — the same class
// of bug as before, just at a fuller content level. CVPilot's own target
// users (CLAUDE.md: "university students and recent graduates") skew
// toward exactly this shape — one job, a handful of skills, maybe a
// couple of references — so biasing this threshold to catch that shape is
// a deliberate product-fit choice, not just a number nudge. Re-verified
// against the same 10-job/25-skill "dense" fixture (still 'dense', its
// fillRatio is nowhere near this boundary) and confirmed this real CV
// still renders on a single page at the sparse-tier's larger spacing (see
// RABBIT_NOTEBOOK.md's dated entry for the exact before/after numbers).
const SPARSE_MAX_FILL_RATIO = 0.55;
const DENSE_MIN_FILL_RATIO = 1.05;

const TIER_ADJUSTMENTS: Record<ProfileDensityTier, Omit<ProfileDensityAdjustment, 'tier'>> = {
  sparse: {
    bodySizeDelta: 1.5,
    sectionGapDelta: 8,
    entryGapDelta: 6,
    bulletGapDelta: 1.5,
    lineGapDelta: 1,
  },
  standard: {
    bodySizeDelta: 0,
    sectionGapDelta: 0,
    entryGapDelta: 0,
    bulletGapDelta: 0,
    lineGapDelta: 0,
  },
  dense: {
    bodySizeDelta: -0.6,
    sectionGapDelta: -4,
    entryGapDelta: -3,
    bulletGapDelta: -1,
    lineGapDelta: -0.4,
  },
};

// A4 in PDFKit's own points (matches `size: 'A4'` in pdf-generation.service.ts
// — 210mm/297mm converted at 72pt/inch). Exported so the browser preview can
// size its own A4 page box in the exact same unit PDFKit lays out in,
// instead of an independently-rounded mm→px conversion.
export const A4_WIDTH_PT = 595.28;
export const A4_HEIGHT_PT = 841.89;

// Rough, rounded reserve for the sidebar cap's own height (name + optional
// title + curve + the fixed photo clearances from profile-pdf-renderer.ts/
// buildProfileCss), used only to estimate the sidebar's REMAINING column
// height for a first page — not an attempt to reproduce drawCap's exact
// arithmetic (that stays each renderer's own job).
const CAP_RESERVE_NO_PHOTO_PT = 100;
const CAP_RESERVE_WITH_PHOTO_PT = 165;

const AVG_CHAR_WIDTH_EM = 0.52;
const LINE_HEIGHT_FACTOR = 1.3;
const HEADING_OVERHEAD_PT = 30;

/** Portable greedy word-wrap line-count estimate — no font-metrics engine,
 *  same algorithm in Node and the browser, so both renderers derive the
 *  identical number from the identical text/width/size. */
function estimateWrappedLines(
  text: string | undefined,
  widthPt: number,
  fontSizePt: number,
): number {
  const clean = (text ?? '').trim();
  if (!clean) return 0;
  const avgCharWidth = fontSizePt * AVG_CHAR_WIDTH_EM;
  const charsPerLine = Math.max(6, Math.floor(widthPt / avgCharWidth));
  const words = clean.split(/\s+/).filter(Boolean);
  let lines = 1;
  let lineLen = 0;
  for (const word of words) {
    const wLen = word.length + 1;
    if (lineLen > 0 && lineLen + wLen > charsPerLine) {
      lines += 1;
      lineLen = wLen;
    } else {
      lineLen += wLen;
    }
  }
  return lines;
}

function textHeight(text: string | undefined, widthPt: number, fontSizePt: number): number {
  return estimateWrappedLines(text, widthPt, fontSizePt) * fontSizePt * LINE_HEIGHT_FACTOR;
}

function estimateSidebarHeight(
  content: CvContent,
  hasPhoto: boolean,
  width: number,
  t: TemplateDefinition,
): number {
  const { personalDetails: pd } = content;
  let h = hasPhoto ? CAP_RESERVE_WITH_PHOTO_PT : CAP_RESERVE_NO_PHOTO_PT;

  const pdRows = [pd.email, pd.phone, pd.location, pd.linkedIn, pd.website, pd.nationality].filter(
    Boolean,
  ) as string[];
  if (pdRows.length) {
    h += HEADING_OVERHEAD_PT;
    for (const row of pdRows) h += textHeight(row, width - 17, t.typography.bodySize - 0.6) + 6;
  }

  const rated = [...content.skills, ...content.languages];
  if (rated.length) {
    h += HEADING_OVERHEAD_PT;
    for (const e of rated) {
      const label = e.level && typeof e.rating !== 'number' ? `${e.name} · ${e.level}` : e.name;
      h += textHeight(label, width - 42, t.typography.bodySize - 0.5) + 7;
    }
  }

  const qualities = content.qualities ?? [];
  if (qualities.length) {
    h += HEADING_OVERHEAD_PT;
    for (const q of qualities) h += textHeight(q, width - 13, t.typography.bodySize - 0.5) + 5;
  }

  return h;
}

function estimateMainHeight(content: CvContent, width: number, t: TemplateDefinition): number {
  let h = 0;
  const order = resolveSectionOrder(content.sectionOrder);
  const sidebarSet = new Set(PROFILE_TEMPLATE.sidebarSections ?? []);
  const mainSections = order.filter((s) => !sidebarSet.has(s));

  for (const section of mainSections) {
    if (section === 'summary' && content.summary) {
      h += HEADING_OVERHEAD_PT + textHeight(content.summary, width, t.typography.bodySize) + 4;
    } else if (section === 'workExperience' && content.workExperience.length) {
      h += HEADING_OVERHEAD_PT;
      for (const e of content.workExperience) {
        h += textHeight(e.title, width * 0.6, t.typography.bodySize) + 2;
        h += textHeight(`${e.company} ${e.location ?? ''}`, width, t.typography.bodySize - 0.3);
        for (const b of e.bullets.filter((x) => x.trim())) {
          h += textHeight(b, width - 20, t.typography.bodySize) + t.spacing.bulletGap;
        }
        h += t.spacing.entryGap + 14;
      }
    } else if (section === 'education' && content.education.length) {
      h += HEADING_OVERHEAD_PT;
      for (const e of content.education) {
        h +=
          textHeight(
            e.field ? `${e.degree} — ${e.field}` : e.degree,
            width * 0.6,
            t.typography.bodySize,
          ) + 2;
        h += textHeight(`${e.institution} ${e.location ?? ''}`, width, t.typography.bodySize - 0.3);
        if (e.grade) h += t.typography.metaSize + 4;
        h += t.spacing.entryGap + 14;
      }
    } else if (section === 'certifications' && content.certifications.length) {
      h += HEADING_OVERHEAD_PT;
      for (const c of content.certifications) {
        h += textHeight(c.name, width, t.typography.bodySize - 0.5) + 2;
        if (c.issuer || c.date) h += t.typography.metaSize + 4;
        h += 10;
      }
    } else if (section === 'references') {
      const refs = content.references ?? [];
      const availableUponRequest = content.referencesAvailableUponRequest ?? false;
      if (refs.length || availableUponRequest) {
        h += HEADING_OVERHEAD_PT;
        if (availableUponRequest) {
          h += textHeight('References available upon request.', width, t.typography.bodySize) + 4;
        } else {
          for (const r of refs) {
            h += textHeight(r.fullName, width, t.typography.bodySize) + 2;
            if (r.jobTitle || r.company) h += t.typography.bodySize + 2;
            if (r.relationship) h += t.typography.metaSize + 2;
            if (r.email || r.phone) h += t.typography.metaSize + 2;
            h += 14;
          }
        }
      }
    }
  }

  return h;
}

/** Picks Profile's density tier for this CV and returns the (possibly
 *  zeroed, for 'standard') deltas to apply on top of PROFILE_TEMPLATE's own
 *  typography/spacing tokens. Pure function of `content`/`template` —
 *  deterministic, no timing/randomness/measurement dependency, safe to call
 *  from both a React render and a PDFKit render pass. */
export interface ProfileFillEstimate {
  sidebarH: number;
  mainH: number;
  columnH: number;
  fillRatio: number;
  tier: ProfileDensityTier;
}

/** The raw estimate behind `estimateProfileDensity`'s tier decision —
 *  exposed separately so it can be inspected/calibrated (and so a future
 *  investigation like this one doesn't need to re-derive it by hand). */
export function estimateProfileFill(
  content: CvContent,
  template: TemplateDefinition = PROFILE_TEMPLATE,
  hasPhoto = false,
): ProfileFillEstimate {
  const pageW = A4_WIDTH_PT - template.margins.left - template.margins.right;
  const gap = template.spacing.sectionGap;
  const sidebarRatio = template.sidebarWidthRatio ?? 0.3;
  const sidebarW = pageW * sidebarRatio - gap / 2;
  const mainW = pageW - sidebarW - gap;
  const columnH = A4_HEIGHT_PT - template.margins.top - template.margins.bottom;

  // Fix (2026-09-17): this estimator systematically OVERESTIMATED real
  // occupied height — confirmed by instrumenting profile-pdf-renderer.ts's
  // actual final `doc.y` for three real fixtures (the builder's own
  // "Example CV", the same plus a second job, and a genuinely long 10-job/
  // 25-skill CV) and comparing against this function's raw numbers before
  // this fix: sidebar 330.8pt estimated vs. 239.2pt actual (×0.723), main
  // 352.2pt vs. 271.2pt (×0.770) for the Example CV, main 450.8pt vs.
  // 336.3pt (×0.746) for the two-job variant. The overestimate came from
  // this module's fixed overhead constants (HEADING_OVERHEAD_PT,
  // CAP_RESERVE_*_PT, LINE_HEIGHT_FACTOR) each being independently
  // generous "safe" guesses rather than measured values — compounding
  // across several of them per CV is what pushed the Example CV's
  // estimated fillRatio (0.465) well above its REAL one (0.358), so it
  // silently landed in 'standard' (zero adjustment) instead of 'sparse'
  // despite the page being visibly, measurably underfilled. Rather than
  // re-deriving every individual constant against real PDFKit metrics
  // (this estimator's whole point is staying font-metrics-free — see this
  // module's own top-of-file doc comment), a single empirically-derived
  // correction factor is applied here, calibrated as the average of the
  // three measured ratios above (0.723, 0.770, 0.746 → 0.746, rounded).
  // Re-validated after this fix against the same three fixtures plus the
  // original bare name+email-only and 10-job/25-skill calibration points
  // from when this module was first written — every one still lands in
  // its intended tier (see RABBIT_NOTEBOOK.md's dated entry for the full
  // before/after numbers).
  const ESTIMATE_CALIBRATION_FACTOR = 0.75;

  const sidebarH =
    estimateSidebarHeight(content, hasPhoto, sidebarW, template) * ESTIMATE_CALIBRATION_FACTOR;
  const mainH = estimateMainHeight(content, mainW, template) * ESTIMATE_CALIBRATION_FACTOR;
  const fillRatio = Math.max(sidebarH / columnH, mainH / columnH);
  const tier = tierForFillRatio(fillRatio);

  return { sidebarH, mainH, columnH, fillRatio, tier };
}

function tierForFillRatio(fillRatio: number): ProfileDensityTier {
  if (fillRatio < SPARSE_MAX_FILL_RATIO) return 'sparse';
  if (fillRatio <= DENSE_MIN_FILL_RATIO) return 'standard';
  return 'dense';
}

export function estimateProfileDensity(
  content: CvContent,
  template: TemplateDefinition = PROFILE_TEMPLATE,
  hasPhoto = false,
): ProfileDensityAdjustment {
  const { tier } = estimateProfileFill(content, template, hasPhoto);
  return { tier, ...TIER_ADJUSTMENTS[tier] };
}

/** Applies a density adjustment on top of a template's own typography/
 *  spacing tokens, returning a NEW TemplateDefinition — never mutates the
 *  input. Both renderers use this so "apply the adjustment" is itself
 *  shared, not just the tier decision. */
export function applyProfileDensity(
  template: TemplateDefinition,
  adjustment: ProfileDensityAdjustment,
): TemplateDefinition {
  if (adjustment.tier === 'standard') return template;
  return {
    ...template,
    typography: {
      ...template.typography,
      // Only body text scales — name/job-title/heading sizes (and the fixed
      // 12pt/18pt photo clearances, which live outside typography entirely)
      // stay exactly as PROFILE_TEMPLATE defines them regardless of tier,
      // per "keep the job title optional... and current colours... scope
      // changes to Profile['s spacing]" — density adjusts body copy and
      // whitespace, not the cap's own identity.
      bodySize: template.typography.bodySize + adjustment.bodySizeDelta,
    },
    spacing: {
      ...template.spacing,
      sectionGap: Math.max(6, template.spacing.sectionGap + adjustment.sectionGapDelta),
      entryGap: Math.max(6, template.spacing.entryGap + adjustment.entryGapDelta),
      bulletGap: Math.max(1.5, template.spacing.bulletGap + adjustment.bulletGapDelta),
      lineGap: Math.max(0.5, template.spacing.lineGap + adjustment.lineGapDelta),
    },
  };
}
