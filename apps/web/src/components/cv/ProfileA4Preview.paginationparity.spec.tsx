/**
 * @jest-environment jsdom
 */
import { buildProfileCss, PROFILE_TEMPLATE, applyProfileDensity } from '@cvpilot/shared';

/**
 * Regression coverage for RABBIT_NOTEBOOK.md §45's two confirmed browser-
 * side fixes: (1) Employment/Education bullet line-height silently
 * inheriting .cv-profile-doc's generic `line-height: 1.5` instead of
 * matching PDFKit's real per-line bullet height, which pushed Education
 * onto page 2 in the browser while the PDF kept it on page 1; (2) a
 * continuation page's sidebar background under-reaching the true page top
 * (leaving a white strip) AND painting OVER the "ALEX JOHNSON" heading
 * (since .cvpf-columns, which contains the bled background, is a LATER
 * DOM sibling than the header — plain in-flow siblings paint in DOM
 * order).
 *
 * jsdom has no real layout engine (`offsetHeight` always 0), so it can't
 * exercise which page anything actually lands on, or render a genuine
 * multi-page scenario to check the header's real stacking outcome — the
 * SAME established limitation documented throughout this component's
 * whole test suite (§23/§24/§37-§44). What these tests CAN do reliably —
 * and do, with real numbers rather than a "some CSS was emitted" check —
 * is verify the actual computed VALUES the fix's formulas produce, so a
 * future refactor can't silently drift them back out of sync without a
 * test failing immediately. The full end-to-end behaviour (which page
 * Education lands on; whether the heading is actually visible; whether
 * the tint actually reaches the true page edge) was verified manually
 * against a real production build and headless-Chrome screenshots — see
 * RABBIT_NOTEBOOK.md §45 for that evidence.
 */

function ruleBodyFor(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
  if (!match || match[1] === undefined) {
    throw new Error(`rule not found for selector: ${selector}`);
  }
  return match[1];
}

describe('bullet line-height parity (RABBIT_NOTEBOOK.md §45 regression)', () => {
  it('computes .cvpf-bullets li line-height from the SAME font-metric ratio and lineGap formula profile-pdf-renderer.ts actually draws with', () => {
    // Measured directly against the real embedded font (LiberationSans-
    // Regular, via PDFKit's own doc.currentLineHeight(), a standalone
    // Node script — see RABBIT_NOTEBOOK.md §45): 1.1171875x font size,
    // consistently. profile-pdf-renderer.ts's renderBullets draws each
    // wrapped line via doc.text(..., { lineGap: t.spacing.lineGap - 1 }).
    const LIBERATION_SANS_LINE_HEIGHT_RATIO = 1.1171875;
    const css = buildProfileCss(PROFILE_TEMPLATE);
    const body = ruleBodyFor(css, '.cv-profile-doc .cvpf-bullets li');
    const match = /line-height:\s*(\d+(?:\.\d+)?)pt\s*;/.exec(body);
    expect(match).not.toBeNull();
    const actualLineHeightPt = parseFloat(match![1]!);

    const expectedLineHeightPt =
      PROFILE_TEMPLATE.typography.bodySize * LIBERATION_SANS_LINE_HEIGHT_RATIO +
      (PROFILE_TEMPLATE.spacing.lineGap - 1);
    expect(actualLineHeightPt).toBeCloseTo(expectedLineHeightPt, 5);
    // Sanity: this must NOT be anywhere near the generic 1.5 .cv-profile-doc
    // itself uses for ordinary paragraph text — that's the exact bug.
    expect(actualLineHeightPt / PROFILE_TEMPLATE.typography.bodySize).toBeLessThan(1.3);
  });

  it('recomputes correctly for a density-adjusted (non-standard) template, not just the base tokens', () => {
    // Regression guard: an earlier draft of this fix hardcoded the base
    // template's bodySize/lineGap instead of reading them off whichever
    // (possibly density-adjusted) template buildProfileCss actually
    // receives — this would silently drift out of sync for any CV dense
    // enough to trigger the 'dense' tier (bodySize -0.6, lineGap -0.4).
    const denseTemplate = applyProfileDensity(PROFILE_TEMPLATE, {
      tier: 'dense',
      bodySizeDelta: -0.6,
      sectionGapDelta: -4,
      entryGapDelta: -3,
      bulletGapDelta: -1,
      lineGapDelta: -0.4,
    });
    const css = buildProfileCss(denseTemplate);
    const body = ruleBodyFor(css, '.cv-profile-doc .cvpf-bullets li');
    const match = /line-height:\s*(\d+(?:\.\d+)?)pt\s*;/.exec(body);
    expect(match).not.toBeNull();
    const actualLineHeightPt = parseFloat(match![1]!);

    const LIBERATION_SANS_LINE_HEIGHT_RATIO = 1.1171875;
    const expectedLineHeightPt =
      denseTemplate.typography.bodySize * LIBERATION_SANS_LINE_HEIGHT_RATIO +
      (denseTemplate.spacing.lineGap - 1);
    expect(actualLineHeightPt).toBeCloseTo(expectedLineHeightPt, 5);
    // Must differ from the base (standard-tier) template's own value —
    // proves this genuinely reads the density-adjusted tokens, not a
    // cached/hardcoded base-tier number.
    const baseCss = buildProfileCss(PROFILE_TEMPLATE);
    const baseBody = ruleBodyFor(baseCss, '.cv-profile-doc .cvpf-bullets li');
    const baseMatch = /line-height:\s*(\d+(?:\.\d+)?)pt\s*;/.exec(baseBody);
    expect(parseFloat(baseMatch![1]!)).not.toBeCloseTo(actualLineHeightPt, 3);
  });
});

describe('continuation-page sidebar background top offset (RABBIT_NOTEBOOK.md §45 regression)', () => {
  it("extends .cvpf-sidebar::before's top offset by a CSS custom property, not just a fixed -marginTop", () => {
    // Fix: a plain -marginTop only reaches the true page top when
    // .cvpf-sidebar is .cv-profile-doc's very FIRST flex child (true on
    // page 1 alone) — on a continuation page, ProfileContinuationHeader
    // is an earlier flex-column sibling pushing .cvpf-sidebar down by its
    // own real height first. --cvpf-cont-header-h (set inline per page by
    // ProfileA4Preview.tsx from the REAL measured continuation-header
    // height) closes that gap exactly, with a 0px fallback so page 1
    // (which never sets it) is completely unaffected.
    const css = buildProfileCss(PROFILE_TEMPLATE);
    const body = ruleBodyFor(css, '.cv-profile-doc .cvpf-sidebar::before');
    expect(body).toMatch(/top:\s*calc\(-40pt\s*-\s*var\(--cvpf-cont-header-h,\s*0px\)\)\s*;/);
  });

  it('gives .cvpf-continuation-header an explicit stacking elevation so it always paints above .cvpf-columns, regardless of geometric overlap', () => {
    // Fix: .cvpf-sidebar's bled ::before is part of .cvpf-columns's box in
    // .cv-profile-doc's own stacking order; .cvpf-columns is a LATER DOM
    // sibling than this header, so plain in-flow siblings paint in DOM
    // order — the bleed painted OVER the header's text, not under it,
    // confirmed by direct inspection (a real screenshot showed the header
    // fully invisible). position: relative + z-index: 1 (a POSITIVE
    // value) guarantees this header wins regardless of exact overlap
    // geometry, without touching the bleed's own z-index: -1 (which only
    // reorders .cvpf-sidebar's OWN children, not its standing relative to
    // this header).
    const css = buildProfileCss(PROFILE_TEMPLATE);
    const body = ruleBodyFor(css, '.cv-profile-doc .cvpf-continuation-header');
    expect(body).toMatch(/position:\s*relative\s*;/);
    expect(body).toMatch(/z-index:\s*1\s*;/);
  });
});
