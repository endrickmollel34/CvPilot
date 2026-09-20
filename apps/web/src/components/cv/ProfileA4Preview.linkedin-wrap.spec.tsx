/**
 * @jest-environment jsdom
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { formatLinkedInLabel, getPersonalDetailsRows, type CvContent } from '@cvpilot/shared';
import { ProfileA4Preview } from './ProfileA4Preview';

class NoopResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(global as unknown as { ResizeObserver: typeof NoopResizeObserver }).ResizeObserver =
  NoopResizeObserver;
(global as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * Regression check for "Improve LinkedIn address rendering"
 * (RABBIT_NOTEBOOK.md): the LinkedIn row previously used shortenUrlLabel
 * (scheme/www stripped but ellipsis-truncated past 26 chars, no tracking-
 * param stripping) and was forced single-line (`white-space: nowrap`).
 * Replaced with formatLinkedInLabel (full untruncated label, tracking
 * params/hash stripped) plus a `wrap: true` flag that lets the row's own
 * `<span>` wrap naturally instead of shrinking or truncating — every other
 * Personal Details row (email/phone/location/website/nationality) is
 * unaffected, confirmed explicitly below.
 */

describe('formatLinkedInLabel', () => {
  it('strips scheme and a leading www.', () => {
    expect(formatLinkedInLabel('https://www.linkedin.com/in/alex-johnson')).toBe(
      'linkedin.com/in/alex-johnson',
    );
  });

  it('strips tracking query parameters and a hash fragment', () => {
    expect(
      formatLinkedInLabel(
        'https://www.linkedin.com/in/alex-johnson?trk=public_profile_browsemap&x=1#section',
      ),
    ).toBe('linkedin.com/in/alex-johnson');
  });

  it('strips a trailing slash', () => {
    expect(formatLinkedInLabel('https://linkedin.com/in/alex-johnson/')).toBe(
      'linkedin.com/in/alex-johnson',
    );
  });

  it('never truncates a long handle', () => {
    const longHandle =
      'alexander-maximilian-christopherson-wordsworth-fitzgerald-example-handle-for-testing';
    expect(formatLinkedInLabel(`https://www.linkedin.com/in/${longHandle}`)).toBe(
      `linkedin.com/in/${longHandle}`,
    );
  });

  it('handles input with no scheme at all', () => {
    expect(formatLinkedInLabel('linkedin.com/in/alex-johnson')).toBe(
      'linkedin.com/in/alex-johnson',
    );
  });
});

describe('getPersonalDetailsRows — LinkedIn row only is marked wrap: true', () => {
  it('marks the linkedIn row wrap: true and every other row wrap: undefined/false', () => {
    const pd: CvContent['personalDetails'] = {
      fullName: 'Alex Johnson',
      email: 'alex@example.com',
      phone: '+44 7700 900123',
      location: 'Manchester, UK',
      linkedIn: 'https://www.linkedin.com/in/alex-johnson?trk=x',
      website: 'https://alexjohnson.dev',
      nationality: 'British',
    };
    const rows = getPersonalDetailsRows(pd);
    const byKey = Object.fromEntries(rows.map((r) => [r.key, r]));

    expect(byKey.linkedIn?.wrap).toBe(true);
    expect(byKey.linkedIn?.text).toBe('linkedin.com/in/alex-johnson');
    expect(byKey.email?.wrap).toBeFalsy();
    expect(byKey.phone?.wrap).toBeFalsy();
    expect(byKey.location?.wrap).toBeFalsy();
    expect(byKey.website?.wrap).toBeFalsy();
    expect(byKey.nationality?.wrap).toBeFalsy();
  });
});

const CONTENT: CvContent = {
  version: 1,
  personalDetails: {
    fullName: 'Alex Johnson',
    email: 'alex@example.com',
    phone: '+44 7700 900123',
    location: 'Manchester, UK',
    linkedIn: 'https://www.linkedin.com/in/alex-johnson?trk=public_profile_browsemap',
    website: 'https://alexjohnson.dev',
    nationality: 'British',
  },
  summary: 'Regression fixture.',
  workExperience: [],
  education: [],
  skills: [],
  languages: [],
  certifications: [],
  sectionOrder: ['summary'],
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

describe('ProfileA4Preview — LinkedIn row wraps, others stay single-line (RABBIT_NOTEBOOK.md regression)', () => {
  let container: HTMLDivElement;
  let root: Root;

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it('renders the LinkedIn link with the clean formatLinkedInLabel text, without white-space: nowrap, on both the visible page and the hidden measurement pass', () => {
    ({ container, root } = mount(CONTENT));

    const linkedInLinks = Array.from(
      container.querySelectorAll<HTMLAnchorElement>('a[href*="linkedin.com"]'),
    );
    // One in the hidden measurement pass, one on the visible page.
    expect(linkedInLinks.length).toBe(2);
    for (const link of linkedInLinks) {
      expect(link.textContent).toBe('linkedin.com/in/alex-johnson');
      const span = link.closest('span');
      expect(span).not.toBeNull();
      expect(getComputedStyle(span as HTMLElement).whiteSpace).toBe('normal');
      // The real href still carries the full original URL, tracking
      // parameter included — only the visible label is cleaned up.
      expect(link.getAttribute('href')).toBe(
        'https://www.linkedin.com/in/alex-johnson?trk=public_profile_browsemap',
      );
    }
  });

  it('leaves every other Personal Details row single-line (white-space: nowrap), unaffected by the LinkedIn fix', () => {
    ({ container, root } = mount(CONTENT));

    const websiteLinks = Array.from(
      container.querySelectorAll<HTMLAnchorElement>('a[href*="alexjohnson.dev"]'),
    );
    expect(websiteLinks.length).toBe(2);
    for (const link of websiteLinks) {
      const span = link.closest('span');
      expect(getComputedStyle(span as HTMLElement).whiteSpace).toBe('nowrap');
    }
  });
});
