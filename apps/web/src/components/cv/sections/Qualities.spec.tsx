/**
 * @jest-environment jsdom
 */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Qualities } from './Qualities';

(global as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * Regression check for the "typed qualities silently vanish" bug
 * (RABBIT_NOTEBOOK.md): CvBuilderWorkspace.tsx only mounts <Qualities>
 * while its accordion panel is expanded, so the component's own local
 * `draft` state — the only place typed-but-not-yet-committed text lived —
 * was lost on unmount whenever the user collapsed the panel (or switched to
 * another one) without pressing Enter first. Fixed by adding an explicit
 * Add button, committing on blur too (which fires a tick before the
 * collapse-triggered unmount), and splitting comma-separated input into
 * separate qualities on commit.
 */

function setup() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  let qualities: string[] = [];
  const onChange = jest.fn((next: string[]) => {
    qualities = next;
    rerender();
  });
  function rerender() {
    act(() => {
      root.render(<Qualities qualities={qualities} onChange={onChange} />);
    });
  }
  rerender();
  return {
    container,
    root,
    onChange,
    getQualities: () => qualities,
    input: () => container.querySelector('input[aria-label="Add quality"]') as HTMLInputElement,
    addButton: () =>
      Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Add')!,
    pillTexts: () =>
      Array.from(container.querySelectorAll('[role="listitem"]')).map((el) =>
        (el.textContent ?? '').replace('×', '').trim(),
      ),
  };
}

function typeInto(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function pressEnter(input: HTMLInputElement) {
  act(() => {
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  });
}

describe('Qualities (RABBIT_NOTEBOOK.md "typed qualities silently vanish" regression)', () => {
  let ctx: ReturnType<typeof setup>;

  afterEach(() => {
    act(() => {
      ctx.root.unmount();
    });
    ctx.container.remove();
  });

  it('adds a quality on Enter', () => {
    ctx = setup();
    typeInto(ctx.input(), 'Team player');
    pressEnter(ctx.input());
    expect(ctx.getQualities()).toEqual(['Team player']);
    expect(ctx.input().value).toBe('');
  });

  it('adds a quality via the explicit Add button, without double-committing', () => {
    ctx = setup();
    typeInto(ctx.input(), 'Detail-oriented');
    act(() => {
      ctx.input().focus();
    });
    act(() => {
      ctx.addButton().dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });
    act(() => {
      ctx.addButton().dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(ctx.getQualities()).toEqual(['Detail-oriented']);
    expect(ctx.onChange).toHaveBeenCalledTimes(1);
  });

  it('commits on blur — the exact case that previously lost the draft when the accordion panel collapsed', () => {
    ctx = setup();
    act(() => {
      ctx.input().focus();
    });
    typeInto(ctx.input(), 'Fast learner');
    act(() => {
      ctx.input().blur();
    });
    expect(ctx.getQualities()).toEqual(['Fast learner']);
  });

  it('splits the reported comma-separated input into separate qualities and trims each', () => {
    ctx = setup();
    typeInto(ctx.input(), 'Time management, Team working, Collaboration');
    pressEnter(ctx.input());
    expect(ctx.getQualities()).toEqual(['Time management', 'Team working', 'Collaboration']);
    expect(ctx.pillTexts()).toEqual(['Time management', 'Team working', 'Collaboration']);
  });

  it('drops empty entries from stray commas', () => {
    ctx = setup();
    typeInto(ctx.input(), 'Team player, , Detail-oriented,');
    pressEnter(ctx.input());
    expect(ctx.getQualities()).toEqual(['Team player', 'Detail-oriented']);
  });

  it('prevents accidental case-insensitive duplicates, both within one commit and against existing entries', () => {
    ctx = setup();
    typeInto(ctx.input(), 'Team player, TEAM PLAYER, Team Player');
    pressEnter(ctx.input());
    expect(ctx.getQualities()).toEqual(['Team player']);

    typeInto(ctx.input(), 'team player');
    pressEnter(ctx.input());
    expect(ctx.getQualities()).toEqual(['Team player']);
  });

  it('does not add anything for whitespace-only input', () => {
    ctx = setup();
    typeInto(ctx.input(), '   ');
    pressEnter(ctx.input());
    expect(ctx.getQualities()).toEqual([]);
    expect(ctx.onChange).not.toHaveBeenCalled();
  });

  it('removes an existing quality', () => {
    ctx = setup();
    typeInto(ctx.input(), 'Team player');
    pressEnter(ctx.input());
    const removeBtn = ctx.container.querySelector(
      'button[aria-label="Remove Team player"]',
    ) as HTMLButtonElement;
    act(() => {
      removeBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(ctx.getQualities()).toEqual([]);
  });
});
