/**
 * @jest-environment jsdom
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
  buildProfileCss,
  PROFILE_TEMPLATE,
  profileSidebarBleedWidthPt,
  profileNameWrapWidthPt,
  resolveProfileNameFontSize,
  ProfileCap,
} from '@cvpilot/shared';

(global as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * Regression coverage for RABBIT_NOTEBOOK.md §44's header-wrapping/
 * viewport-instability fixes. jsdom cannot exercise real canvas text
 * measurement (`HTMLCanvasElement.getContext('2d')` is "not implemented"
 * — the same established limitation documented throughout this
 * component's own test suite), so `resolveProfileNameFontSize` is tested
 * here with a real, working mocked 2D context (a monospace-metric stand-
 * in: every character is exactly `size * 0.6` px wide) rather than a CSS-
 * string or DOM-presence check — this exercises the ACTUAL greedy word-
 * wrap line-counting algorithm the browser preview runs, with real
 * (mocked) measurements flowing through it, not an approximation of it.
 */

function installMockCanvasContext() {
  const orig = HTMLCanvasElement.prototype.getContext;
  let currentFont = '';
  const fakeCtx = {
    set font(value: string) {
      currentFont = value;
    },
    get font() {
      return currentFont;
    },
    measureText(text: string) {
      const sizeMatch = /(\d+(?:\.\d+)?)px/.exec(currentFont);
      const sizePx = sizeMatch ? parseFloat(sizeMatch[1]!) : 16;
      return { width: text.length * sizePx * 0.6 };
    },
  };
  // @ts-expect-error — deliberately narrow mock, only what resolveProfileNameFontSize uses
  HTMLCanvasElement.prototype.getContext = () => fakeCtx;
  return () => {
    HTMLCanvasElement.prototype.getContext = orig;
  };
}

describe('resolveProfileNameFontSize (RABBIT_NOTEBOOK.md §44 regression)', () => {
  let restore: () => void;
  beforeEach(() => {
    restore = installMockCanvasContext();
  });
  afterEach(() => restore());

  it('keeps the base (unshrunk) size for a short two-word name at a generous width', () => {
    // "Alex Johnson" = 12 chars; at the base size (21pt = 28px) each word
    // is comfortably under a wide 400px budget — never needs to shrink,
    // and correctly wraps to at most 2 lines regardless (one line per
    // word in the worst case), which the "<=3 lines" algorithm accepts
    // immediately at the base size.
    const size = resolveProfileNameFontSize('Alex Johnson', 400);
    expect(size).toBe(PROFILE_TEMPLATE.typography.nameSize);
  });

  it('shrinks a genuinely long multi-word name that would otherwise exceed 3 lines at a narrow width', () => {
    // 6 words, each forced onto its own line at a narrow 40px width and
    // the base size — 6 lines, over budget — must shrink toward the
    // floor to bring the line count back to <=3.
    const longName = 'Wolfgang Alexander Christopher Montgomery Fitzgerald Windsor';
    const size = resolveProfileNameFontSize(longName, 40);
    expect(size).toBeLessThan(PROFILE_TEMPLATE.typography.nameSize);
    expect(size).toBeGreaterThanOrEqual(14); // PROFILE_NAME_FLOOR_SIZE
  });

  it('never returns a value that regresses the caller when given a zero-width measurement (defensive fallback)', () => {
    expect(resolveProfileNameFontSize('Alex Johnson', 0)).toBe(
      PROFILE_TEMPLATE.typography.nameSize,
    );
  });
});

describe('profileSidebarBleedWidthPt / profileNameWrapWidthPt (RABBIT_NOTEBOOK.md §44 regression)', () => {
  it("computes the exact PDFKit-equivalent bleed width for PROFILE_TEMPLATE's own defaults", () => {
    // Hand-derived from profile-pdf-renderer.ts's own sidebarBleedRight
    // formula (SIDEBAR_INSET + sidebarW + gap/2, which algebraically
    // reduces to SIDEBAR_INSET + pageW*ratio for this template's own
    // sidebarW = pageW*ratio - gap/2): pageContentWidthPt = 595.28 - 40 -
    // 40 = 515.28; sidebarColumnWidthPt = 515.28 * 0.3 = 154.584;
    // 22 + 154.584 + 15/2 = 184.084. Matches
    // ProfileA4Preview.sidebar-geometry.spec.tsx's own independently-
    // asserted "184.084pt" for the identical template — two different
    // tests deriving the same real number confirms neither drifted.
    expect(profileSidebarBleedWidthPt(PROFILE_TEMPLATE)).toBeCloseTo(184.084, 5);
  });

  it('subtracts exactly 2x CAP_PADDING_X (12pt each side) from the bleed width for the name-wrap width', () => {
    const bleed = profileSidebarBleedWidthPt(PROFILE_TEMPLATE);
    expect(profileNameWrapWidthPt(PROFILE_TEMPLATE)).toBeCloseTo(bleed - 24, 5);
  });

  it("is genuinely WIDER than .cvpf-cap's own rendered content-box width — the actual root cause this fix closes", () => {
    // .cvpf-cap's own content width = sidebarColumnWidthPt - 2*CAP_PADDING_X
    // (NOT bled) = 154.584 - 24 = 130.584pt — narrower than
    // profileNameWrapWidthPt (160.084pt) by exactly SIDEBAR_INSET + half
    // the section gap (27.5pt). A real "Alex Johnson" at 21pt needs
    // ~137.7pt (measured directly against PDFKit's own LiberationSans-Bold
    // font in this task's investigation) — comfortably under the WIDER
    // width, but over the narrower one, which is exactly why the name
    // used to wrap in the browser but not in the PDF.
    const A4_WIDTH_PT = 595.28;
    const pageContentWidthPt =
      A4_WIDTH_PT - PROFILE_TEMPLATE.margins.left - PROFILE_TEMPLATE.margins.right;
    const sidebarPct = Math.round((PROFILE_TEMPLATE.sidebarWidthRatio ?? 0.3) * 100);
    const sidebarColumnWidthPt = (pageContentWidthPt * sidebarPct) / 100;
    const capContentWidthPt = sidebarColumnWidthPt - 24; // 2 x CAP_PADDING_X
    expect(profileNameWrapWidthPt(PROFILE_TEMPLATE)).toBeGreaterThan(capContentWidthPt);
  });
});

describe('ProfileCap nameFontSize prop (RABBIT_NOTEBOOK.md §44 regression)', () => {
  it('uses the externally-supplied nameFontSize as-is, bypassing its own internal resolution', () => {
    // ProfileA4Preview.tsx always supplies this explicitly (computed once,
    // synchronously, in its own measurement effect — see that file's own
    // doc comment) precisely so the rendered cap can never independently
    // resolve to a DIFFERENT value than what pagination assumed. Passing
    // a value nothing in jsdom's canvas-less environment could ever
    // independently compute (canvas.getContext('2d') is "not implemented"
    // there, so the internal hook always falls back to the base size)
    // proves the prop genuinely takes precedence, not just that it's
    // accepted.
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);
    act(() => {
      root.render(
        <ProfileCap pd={{ fullName: 'Alex Johnson', email: 'a@b.com' }} nameFontSize={17.5} />,
      );
    });
    const h1 = container.querySelector('h1');
    expect(h1).not.toBeNull();
    expect(h1!.style.fontSize).toBe('17.5pt');
    expect(h1!.style.fontSize).not.toBe(`${PROFILE_TEMPLATE.typography.nameSize}pt`);
    act(() => root.unmount());
    container.remove();
  });
});

describe('buildProfileCss (RABBIT_NOTEBOOK.md §44 regression)', () => {
  it('contains no viewport-conditional @media rule — the visible page and the hidden measurement pass must both stay a fixed, A4-proportioned document at every browser window size', () => {
    // Fix: a leftover "@media (max-width: 700px) { ... }" rule reflowed
    // .cv-profile-doc's layout (and therefore every width-dependent
    // measurement inside it — the cap's name wrap, every skill/language/
    // quality row) whenever the REAL browser viewport happened to be
    // narrow, silently corrupting pagination for BOTH the visible page
    // and the hidden, explicitly-fixed-width measurement pass. Confirmed
    // via direct measurement: the identical CV produced a measured cap
    // height of 206px at a 1600px-wide window vs 153px at 700px, and a
    // Qualities list that paginated correctly at one width but silently
    // overflowed page 1 (clipped by the page box's own overflow: hidden)
    // at the other. This asserts the mechanism is actually GONE, not
    // merely that some other change was made.
    const css = buildProfileCss(PROFILE_TEMPLATE);
    // Strip comments first — the fix's own doc comment mentions the removed
    // rule by name as an explanation, which would otherwise false-positive
    // a naive substring search.
    const cssWithoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(cssWithoutComments).not.toMatch(/@media/);
  });

  it("extends .cvpf-cap h1 and .cvpf-job-title's wrap width via a symmetric negative margin, matching profileNameWrapWidthPt", () => {
    const css = buildProfileCss(PROFILE_TEMPLATE);
    const h1Match = css.match(/\.cv-profile-doc \.cvpf-cap h1 \{([^}]*)\}/);
    const jobTitleMatch = css.match(/\.cv-profile-doc \.cvpf-job-title \{([^}]*)\}/);
    expect(h1Match).not.toBeNull();
    expect(jobTitleMatch).not.toBeNull();

    // capNameWrapExtraPt = (profileNameWrapWidthPt - capContentWidthPt) / 2
    // = (160.084 - 130.584) / 2 = 14.75
    const expectedExtraPt = 14.75;
    const h1MarginMatch = /margin:\s*0 -(\d+(?:\.\d+)?)pt\s*;/.exec(h1Match![1]!);
    expect(h1MarginMatch).not.toBeNull();
    expect(parseFloat(h1MarginMatch![1]!)).toBeCloseTo(expectedExtraPt, 5);

    const jobTitleMarginMatch = /margin:\s*5pt -(\d+(?:\.\d+)?)pt 0\s*;/.exec(jobTitleMatch![1]!);
    expect(jobTitleMarginMatch).not.toBeNull();
    expect(parseFloat(jobTitleMarginMatch![1]!)).toBeCloseTo(expectedExtraPt, 5);
  });

  it("leaves .cvpf-cap's own box/padding/width completely untouched — only the text elements' wrap width changed", () => {
    // The EARLIER attempt at this exact fix widened .cvpf-cap's own box,
    // which reopened a sidebar-clipping regression (see .cvpf-sidebar's
    // own doc comment on .cvpf-sidebar::before) — this test guards
    // against that specific regression recurring: .cvpf-cap's padding
    // must stay exactly 22pt/12pt/20pt, unaffected by this fix.
    const css = buildProfileCss(PROFILE_TEMPLATE);
    const capMatch = css.match(/\.cv-profile-doc \.cvpf-cap \{([^}]*)\}/);
    expect(capMatch).not.toBeNull();
    expect(capMatch![1]).toMatch(/padding:\s*22pt 12pt 20pt\s*;/);
  });
});
