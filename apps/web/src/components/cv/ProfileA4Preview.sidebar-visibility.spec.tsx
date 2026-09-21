/**
 * @jest-environment jsdom
 */
import { buildProfileCss, PROFILE_TEMPLATE } from '@cvpilot/shared';

/**
 * Regression check for the production Profile-preview bug (RABBIT_NOTEBOOK.md):
 * the name, job title, Personal Details, Skills, and Languages all rendered
 * correctly into the DOM but were visually INVISIBLE — silently painted
 * underneath the opaque, page-edge-bleed `::before` decorations added on
 * `.cvpf-sidebar-first`/`.cvpf-cap` (RABBIT_NOTEBOOK.md §25).
 *
 * Root cause: those `::before` pseudo-elements are `position: absolute`
 * with `z-index: auto`. Per CSS painting order, a positioned box with
 * z-index: auto/0 always paints ABOVE ordinary non-positioned in-flow
 * content within the same stacking context, regardless of DOM order — so
 * the (non-positioned) name/job-title/Personal-Details/Skills/Languages
 * content was silently painted underneath these opaque bleed rectangles.
 * Only content that happened to ALSO be positioned escaped this: the photo
 * (`.cvpf-photo-wrap` is `position: absolute`) and Qualities `<li>` items
 * (`.cvpf-qualities li` is `position: relative`, for their own bullet-dot
 * marker) — which is exactly why only those two kept rendering visibly.
 * Confirmed via direct `elementFromPoint` hit-testing against a real local
 * production build (`next build && next start`) before this fix, and
 * re-verified after.
 *
 * Fix: `.cvpf-sidebar`/`.cvpf-cap` each get `z-index: 0`, making them their
 * OWN stacking contexts; their `::before` bleeds then get `z-index: -1`,
 * resolved LOCALLY against that new context, so they paint behind their
 * own real content instead of in front of it.
 *
 * jsdom has no real layout/paint engine, so it can't reproduce the actual
 * visual coverage the way a real browser's `elementFromPoint` can (see the
 * pagination spec's own doc comment for the same limitation) — what this
 * test CAN do, reliably, is assert the exact CSS mechanism the fix relies
 * on is present in the generated stylesheet: reverting the z-index rules
 * (the actual regression this guards against) makes this test fail
 * immediately, without needing a real browser.
 */

describe('buildProfileCss sidebar/cap stacking order (RABBIT_NOTEBOOK.md sidebar-content-invisible regression)', () => {
  const css = buildProfileCss(PROFILE_TEMPLATE);

  function ruleBodyFor(selector: string): string {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
    if (!match || match[1] === undefined) {
      throw new Error(`rule not found for selector: ${selector}`);
    }
    return match[1];
  }

  it('makes .cvpf-sidebar its own stacking context (z-index: 0)', () => {
    expect(ruleBodyFor('.cv-profile-doc .cvpf-sidebar ')).toMatch(/z-index:\s*0\s*;/);
  });

  it('paints .cvpf-sidebar::before BEHIND real content (z-index: -1)', () => {
    // Fix (RABBIT_NOTEBOOK.md §44): widened from .cvpf-sidebar-first::before
    // to plain .cvpf-sidebar::before — every page's sidebar bleed now
    // paints behind real content, not just page 1's (see that fix's own
    // doc comment in profile-document.tsx).
    expect(ruleBodyFor('.cv-profile-doc .cvpf-sidebar::before')).toMatch(/z-index:\s*-1\s*;/);
  });

  it('makes .cvpf-cap its own stacking context (z-index: 0)', () => {
    expect(ruleBodyFor('.cv-profile-doc .cvpf-cap ')).toMatch(/z-index:\s*0\s*;/);
  });

  it('paints .cvpf-cap::before BEHIND real content (z-index: -1)', () => {
    expect(ruleBodyFor('.cv-profile-doc .cvpf-cap::before')).toMatch(/z-index:\s*-1\s*;/);
  });
});
