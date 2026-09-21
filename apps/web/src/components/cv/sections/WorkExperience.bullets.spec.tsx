/**
 * @jest-environment jsdom
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { CvWorkEntry } from '@cvpilot/shared';
import { WorkExperience } from './WorkExperience';

(global as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * Regression coverage for RABBIT_NOTEBOOK.md §44's "improve long
 * employment-bullet editing" fix: single-line `<input>` bullets replaced
 * with wrapping, auto-growing `<textarea>`s, Enter inserting a new bullet
 * (not a literal newline — bullets are rendered as one wrappable line by
 * both CV renderers), and existing autosave/ordering/deletion/data all
 * preserved.
 */

function makeEntry(bullets: string[]): CvWorkEntry {
  return {
    id: 'w1',
    company: 'Acme',
    title: 'Engineer',
    startDate: '2024-01',
    current: true,
    bullets,
  };
}

// React overrides a controlled <textarea>'s own `value` setter to track
// changes; setting `.value` directly (bypassing that tracked setter) makes
// React's synthetic onChange never fire on the subsequent native 'input'
// event. Using the PROTOTYPE's native setter first, then dispatching the
// event, is the standard way to simulate real typing without
// @testing-library's `fireEvent` (not a dependency here).
function typeIntoTextarea(el: HTMLTextAreaElement, value: string) {
  const nativeSetter = Object.getOwnPropertyDescriptor(
    window.HTMLTextAreaElement.prototype,
    'value',
  )!.set!;
  nativeSetter.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

function mount(entries: CvWorkEntry[], onChange: (e: CvWorkEntry[]) => void) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  act(() => {
    root.render(<WorkExperience entries={entries} onChange={onChange} />);
  });
  return { container, root };
}

describe('WorkExperience bullet editing (RABBIT_NOTEBOOK.md §44 regression)', () => {
  let container: HTMLDivElement;
  let root: Root;

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('renders each bullet as a <textarea>, not a single-line <input>', () => {
    ({ container, root } = mount([makeEntry(['Built REST APIs', 'Reduced load time'])], () => {}));
    const textareas = container.querySelectorAll('textarea[aria-label^="Bullet point"]');
    expect(textareas.length).toBe(2);
    const inputs = container.querySelectorAll('input[aria-label^="Bullet point"]');
    expect(inputs.length).toBe(0);
  });

  it('preserves existing bullet text and ordering exactly, unedited', () => {
    const bullets = ['First achievement', 'Second achievement', 'Third achievement'];
    ({ container, root } = mount([makeEntry(bullets)], () => {}));
    const textareas = Array.from(
      container.querySelectorAll<HTMLTextAreaElement>('textarea[aria-label^="Bullet point"]'),
    );
    expect(textareas.map((t) => t.value)).toEqual(bullets);
  });

  it('calls onChange with the edited bullet text — autosave wiring unchanged', () => {
    let latest: CvWorkEntry[] = [];
    const onChange = (e: CvWorkEntry[]) => {
      latest = e;
    };
    ({ container, root } = mount([makeEntry(['Original text'])], onChange));
    const textarea = container.querySelector<HTMLTextAreaElement>(
      'textarea[aria-label="Bullet point 1"]',
    )!;
    act(() => {
      typeIntoTextarea(textarea, 'Edited text');
    });
    expect(latest[0]?.bullets).toEqual(['Edited text']);
  });

  it('Enter inserts a NEW bullet after the current one instead of a literal newline in the text', () => {
    let latest: CvWorkEntry[] = [];
    const onChange = (e: CvWorkEntry[]) => {
      latest = e;
    };
    ({ container, root } = mount([makeEntry(['First bullet', 'Second bullet'])], onChange));
    const firstTextarea = container.querySelector<HTMLTextAreaElement>(
      'textarea[aria-label="Bullet point 1"]',
    )!;
    act(() => {
      firstTextarea.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
      );
    });
    expect(latest[0]?.bullets).toEqual(['First bullet', '', 'Second bullet']);
    // No literal "\n" was ever written into the original bullet's text.
    expect(latest[0]?.bullets[0]).not.toContain('\n');
  });

  it('Shift+Enter does NOT insert a new bullet (reserved for a literal newline, unlike plain Enter)', () => {
    let latest: CvWorkEntry[] = [];
    const onChange = (e: CvWorkEntry[]) => {
      latest = e;
    };
    ({ container, root } = mount([makeEntry(['Only bullet'])], onChange));
    const textarea = container.querySelector<HTMLTextAreaElement>(
      'textarea[aria-label="Bullet point 1"]',
    )!;
    act(() => {
      textarea.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Enter',
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    expect(latest).toEqual([]); // onChange never called — no bullet-list mutation
  });

  it('the "+ Add bullet" control still appends a new empty bullet at the end, unchanged', () => {
    let latest: CvWorkEntry[] = [];
    const onChange = (e: CvWorkEntry[]) => {
      latest = e;
    };
    ({ container, root } = mount([makeEntry(['Existing bullet'])], onChange));
    const addButton = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent === '+ Add bullet',
    )!;
    act(() => {
      addButton.click();
    });
    expect(latest[0]?.bullets).toEqual(['Existing bullet', '']);
  });

  it('removing a bullet still deletes exactly that one, preserving the rest in order', () => {
    let latest: CvWorkEntry[] = [];
    const onChange = (e: CvWorkEntry[]) => {
      latest = e;
    };
    ({ container, root } = mount([makeEntry(['Keep A', 'Remove me', 'Keep B'])], onChange));
    const removeButtons = Array.from(container.querySelectorAll('button')).filter((b) =>
      b.getAttribute('aria-label')?.startsWith('Remove bullet point'),
    );
    act(() => {
      removeButtons[1]!.click(); // "Remove bullet point 2" — "Remove me"
    });
    expect(latest[0]?.bullets).toEqual(['Keep A', 'Keep B']);
  });

  it('a long bullet wraps (no horizontal scroll) — textarea has resize-none and overflow-hidden, not a fixed single-line box', () => {
    const longBullet =
      'Collaborated with a cross-functional team of 12 engineers, designers, and product managers to ship a major feature that increased weekly active users by 23% over two quarters.';
    ({ container, root } = mount([makeEntry([longBullet])], () => {}));
    const textarea = container.querySelector<HTMLTextAreaElement>(
      'textarea[aria-label="Bullet point 1"]',
    )!;
    expect(textarea.value).toBe(longBullet);
    expect(textarea.className).toMatch(/resize-none/);
    expect(textarea.className).toMatch(/overflow-hidden/);
    expect(textarea.rows).toBe(1); // starting rows — real height comes from auto-grow, not a fixed row count
  });
});
