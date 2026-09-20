/**
 * @jest-environment jsdom
 */
import { buildProfileCss, PROFILE_TEMPLATE } from '@cvpilot/shared';

/**
 * Regression check for the sidebar width/padding rebalance
 * (RABBIT_NOTEBOOK.md): the colored sidebar previously took ~33-35% of the
 * page (PROFILE_TEMPLATE.sidebarWidthRatio: 0.33) with 16pt of internal
 * left/right padding on both the cap and the sidebar body, crowding
 * Employment/Education/References in the main column. Target: ~30%
 * sidebar / 70% main, with the recovered width given entirely to the main
 * column (not achieved by shrinking any text).
 *
 * Also covers the FOLLOW-UP left-inset rebalance: even after the above,
 * Personal Details/Skills/Languages/Qualities still started at the page's
 * full 40pt margin (the same margin the plain white main column uses) —
 * confirmed excessive by inspecting a real downloaded PDF. Target: an
 * effective ~20-24pt inset from the TRUE page edge, achieved by shifting
 * the whole sidebar box left (`.cvpf-sidebar`'s own `margin-left`) rather
 * than by shrinking `sidebarWidthRatio` again — the sidebar's own text
 * WIDTH (`sidebarColumnWidthPt`) is unchanged throughout.
 *
 * This asserts the actual generated values, not just that "some change was
 * made" — reverting any of the ratio, the padding, or the new inset shift
 * makes the relevant assertion below fail.
 */
describe('Profile sidebar width/padding rebalance (RABBIT_NOTEBOOK.md regression)', () => {
  it('sets PROFILE_TEMPLATE.sidebarWidthRatio to 0.3 (~30% sidebar / 70% main)', () => {
    expect(PROFILE_TEMPLATE.sidebarWidthRatio).toBe(0.3);
  });

  it('renders .cvpf-sidebar at flex-basis/max-width 30%, not the old 33%', () => {
    const css = buildProfileCss(PROFILE_TEMPLATE);
    const match = css.match(/\.cv-profile-doc \.cvpf-sidebar \{([^}]*)\}/);
    expect(match).not.toBeNull();
    const body = match![1];
    expect(body).toMatch(/flex:\s*0 0 30%\s*;/);
    expect(body).toMatch(/max-width:\s*30%\s*;/);
  });

  it('reduces .cvpf-cap left/right padding from 16pt to 12pt, leaving top/bottom untouched', () => {
    const css = buildProfileCss(PROFILE_TEMPLATE);
    const match = css.match(/\.cv-profile-doc \.cvpf-cap \{([^}]*)\}/);
    expect(match).not.toBeNull();
    expect(match![1]).toMatch(/padding:\s*22pt 12pt 20pt\s*;/);
  });

  it('shifts .cvpf-sidebar left by 18pt (marginLeft 40pt - SIDEBAR_INSET 22pt), the mechanism that recovers width for main without shrinking sidebar text', () => {
    const css = buildProfileCss(PROFILE_TEMPLATE);
    const match = css.match(/\.cv-profile-doc \.cvpf-sidebar \{([^}]*)\}/);
    expect(match).not.toBeNull();
    expect(match![1]).toMatch(/margin-left:\s*-18pt\s*;/);
  });

  it('gives .cvpf-sidebar-body flush-left (0pt) padding, relying on the box shift above for the ~22pt effective inset, while keeping 12pt on the right near the column boundary', () => {
    const css = buildProfileCss(PROFILE_TEMPLATE);
    const match = css.match(/\.cv-profile-doc \.cvpf-sidebar-body \{([^}]*)\}/);
    expect(match).not.toBeNull();
    expect(match![1]).toMatch(/padding:\s*18pt 12pt 20pt 0pt\s*;/);
  });

  it('re-anchors the sidebar-first and cap bleed pseudo-elements to the new SIDEBAR_INSET (-22pt), not the old -marginLeft (-40pt), so they still reach the true page edge after the box shift', () => {
    const css = buildProfileCss(PROFILE_TEMPLATE);
    const sidebarBleed = css.match(/\.cv-profile-doc \.cvpf-sidebar-first::before \{([^}]*)\}/);
    const capBleed = css.match(/\.cv-profile-doc \.cvpf-cap::before \{([^}]*)\}/);
    expect(sidebarBleed).not.toBeNull();
    expect(capBleed).not.toBeNull();
    expect(sidebarBleed![1]).toMatch(/left:\s*-22pt\s*;/);
    expect(capBleed![1]).toMatch(/left:\s*-22pt\s*;/);
    // Not the old, now-incorrect offset — would overshoot past the true
    // page edge given .cvpf-sidebar's own new margin-left.
    expect(sidebarBleed![1]).not.toMatch(/left:\s*-40pt\s*;/);
  });

  it('shrinks the sidebar bleed width by the same 18pt the content moved left by (184.084pt, was 202.084pt)', () => {
    const css = buildProfileCss(PROFILE_TEMPLATE);
    const match = css.match(/\.cv-profile-doc \.cvpf-sidebar-first::before \{([^}]*)\}/);
    expect(match).not.toBeNull();
    expect(match![1]).toMatch(/width:\s*184\.084pt\s*;/);
  });
});
