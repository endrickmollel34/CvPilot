/**
 * @jest-environment jsdom
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { CvContent } from '@cvpilot/shared';
import { ProfileA4Preview } from './ProfileA4Preview';

// jsdom has no real ResizeObserver — ProfileA4Preview only uses it to
// recompute the visual `scale` for the zoom-fit page box, unrelated to
// this test's pagination/measurement assertions, so a no-op stub is
// sufficient (and avoids a hard "ResizeObserver is not defined" crash).
class NoopResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(global as unknown as { ResizeObserver: typeof NoopResizeObserver }).ResizeObserver =
  NoopResizeObserver;

// Required by React 19's `act` when not going through a testing-library
// helper that sets this automatically.
(global as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * Focused regression check for the §23/§24 sidebar-clipping bug
 * (RABBIT_NOTEBOOK.md): the hidden measurement pass used to render each
 * sidebar item (Skill/Language/Quality) as a bare `<li>` with no enclosing
 * `<ul class="cvpf-rated-list">`/`<ul class="cvpf-qualities">`, so the CSS
 * spacing rules that only apply through that wrapper (`margin-top: 7pt`/
 * `5pt` per item, `margin: 8pt 0 0` per list) never applied during
 * measurement — undercounting every item's real footprint and packing too
 * much content onto page 1, silently clipped by the page box's own
 * `overflow: hidden`.
 *
 * jsdom does not run a real layout engine (`getBoundingClientRect` and
 * `offsetHeight` always report 0), so this test cannot reproduce the
 * original bug's actual visual symptom (real geometric clipping) — that
 * was, and remains, verified with a real browser (see RABBIT_NOTEBOOK.md
 * §24). What jsdom CAN do — because it resolves CSS selectors against an
 * injected `<style>` tag correctly, independent of layout — is check the
 * STRUCTURAL fix directly: that the hidden measurement pass renders the
 * exact same `<ul>` wrapper markup, with the exact same computed
 * margin-top per item, as the visible page. That structural match is the
 * actual mechanism the fix relies on, and reverting to the old bare-list
 * markup (the regression this guards against) would make this test fail
 * immediately, before ever needing a real browser to notice.
 */

const MANY_SKILLS_AND_QUALITIES_CONTENT: CvContent = {
  version: 1,
  personalDetails: {
    fullName: 'Regression Test',
    email: 'regression.test@example.test',
    phone: '+44 0000 000000',
    location: 'Testville, UK',
  },
  summary: 'Fixture content for the sidebar-clipping regression check.',
  workExperience: [],
  education: [],
  skills: Array.from({ length: 5 }, (_, i) => ({
    id: `sk-${i}`,
    name: `Regression Skill ${i + 1}`,
  })),
  languages: [{ id: 'lang-1', name: 'Regression Language', level: 'Fluent' }],
  qualities: ['Regression quality 1', 'Regression quality 2'],
  certifications: [],
  sectionOrder: ['summary', 'skills', 'languages'],
};

function mount(content: CvContent): { container: HTMLDivElement; root: Root } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<ProfileA4Preview content={content} photoUrl={null} />);
  });
  return { container, root };
}

function getHiddenMeasurementPass(container: HTMLDivElement): HTMLElement {
  const hidden = container.querySelector('[aria-hidden="true"]');
  if (!hidden) throw new Error('hidden measurement pass not found');
  return hidden as HTMLElement;
}

describe('ProfileA4Preview sidebar measurement pass (RABBIT_NOTEBOOK.md §23/§24 regression)', () => {
  let container: HTMLDivElement;
  let root: Root;

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it('wraps skills and languages each in their own real <ul class="cvpf-rated-list"> during measurement, matching the visible page', () => {
    ({ container, root } = mount(MANY_SKILLS_AND_QUALITIES_CONTENT));

    const hidden = getHiddenMeasurementPass(container);
    // One <ul class="cvpf-rated-list"> per contiguous section (Skills,
    // Languages) — SidebarColumnItems groups consecutive same-title
    // blocks into separate lists, not one shared list.
    const hiddenRatedLists = hidden.querySelectorAll('.cvpf-sidebar-body ul.cvpf-rated-list');
    expect(hiddenRatedLists.length).toBe(2);
    const hiddenRatedItems = hidden.querySelectorAll('.cvpf-sidebar-body ul.cvpf-rated-list li');
    expect(hiddenRatedItems.length).toBe(
      MANY_SKILLS_AND_QUALITIES_CONTENT.skills.length +
        MANY_SKILLS_AND_QUALITIES_CONTENT.languages.length,
    );

    // The visible page must exist too and use the identical wrapper class
    // — confirms measurement and display haven't drifted onto two
    // different markup shapes.
    const visibleRatedList = container.querySelector(
      '.mx-auto.w-full > .flex.flex-col ul.cvpf-rated-list',
    );
    expect(visibleRatedList).not.toBeNull();
  });

  it('wraps qualities in the real <ul class="cvpf-qualities"> during measurement, matching the visible page', () => {
    ({ container, root } = mount(MANY_SKILLS_AND_QUALITIES_CONTENT));

    const hidden = getHiddenMeasurementPass(container);
    const hiddenQualitiesList = hidden.querySelector('.cvpf-sidebar-body ul.cvpf-qualities');
    expect(hiddenQualitiesList).not.toBeNull();
    expect(hiddenQualitiesList?.querySelectorAll('li').length).toBe(
      MANY_SKILLS_AND_QUALITIES_CONTENT.qualities?.length,
    );
  });

  it('gives every non-first sidebar <li> in the measurement pass the real CSS margin-top — the exact spacing the old bare-list markup lost', () => {
    ({ container, root } = mount(MANY_SKILLS_AND_QUALITIES_CONTENT));

    const hidden = getHiddenMeasurementPass(container);
    const skillList = hidden.querySelector('.cvpf-sidebar-body ul.cvpf-rated-list');
    const skillItems = Array.from(skillList?.querySelectorAll('li') ?? []);
    expect(skillItems.length).toBe(MANY_SKILLS_AND_QUALITIES_CONTENT.skills.length);

    // First item in a `.cvpf-rated-list` is CSS `:first-child` — zero
    // margin, by design. Every item after it must carry the real
    // `margin-top: 7pt` rule declared on `.cv-profile-doc .cvpf-rated-list
    // li` — this is exactly the spacing the bug's bare `<li>` markup never
    // received, because that selector cannot match an `<li>` with no
    // `<ul class="cvpf-rated-list">` ancestor. (jsdom resolves the CSS
    // cascade from the injected stylesheet correctly, but doesn't convert
    // units — the declared "7pt" comes back as-is, not px-converted.)
    expect(getComputedStyle(skillItems[0] as HTMLElement).marginTop).toBe('0px');
    for (const li of skillItems.slice(1)) {
      expect(getComputedStyle(li as HTMLElement).marginTop).toBe('7pt');
    }

    // Qualities carry their own (5pt) rule the same way, on EVERY item —
    // `.cvpf-qualities li` has no `:first-child` override (see
    // profile-document.tsx), so the CSS margin applies uniformly, unlike
    // rated-list items.
    const qualityItems = Array.from(
      hidden.querySelectorAll('.cvpf-sidebar-body ul.cvpf-qualities li'),
    );
    expect(qualityItems.length).toBe(2);
    for (const li of qualityItems) {
      expect(getComputedStyle(li as HTMLElement).marginTop).toBe('5pt');
    }
  });
});
