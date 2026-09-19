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
 * column (not achieved by shrinking any text), plus tighter, still-
 * symmetric internal padding closer to what the PDF renderer already uses.
 *
 * This asserts the actual generated values, not just that "some change was
 * made" — reverting either the ratio or the padding makes this fail.
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

  it('reduces .cvpf-sidebar-body left/right padding from 16pt to 12pt, keeping it symmetric', () => {
    const css = buildProfileCss(PROFILE_TEMPLATE);
    const match = css.match(/\.cv-profile-doc \.cvpf-sidebar-body \{([^}]*)\}/);
    expect(match).not.toBeNull();
    expect(match![1]).toMatch(/padding:\s*18pt 12pt 20pt\s*;/);
  });

  it('reduces .cvpf-cap left/right padding from 16pt to 12pt, leaving top/bottom untouched', () => {
    const css = buildProfileCss(PROFILE_TEMPLATE);
    const match = css.match(/\.cv-profile-doc \.cvpf-cap \{([^}]*)\}/);
    expect(match).not.toBeNull();
    expect(match![1]).toMatch(/padding:\s*22pt 12pt 20pt\s*;/);
  });
});
