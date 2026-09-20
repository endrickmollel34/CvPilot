import { packColumn, type Block } from './ProfileA4Preview';

/**
 * Direct unit tests for `packColumn` as a pure function — jsdom reports 0
 * for `offsetHeight`/`getBoundingClientRect` (no real layout engine), so
 * the actual page-splitting DECISIONS this function makes can't be
 * exercised meaningfully through a full component render in this test
 * environment (see ProfileA4Preview.pagination.spec.tsx's own doc comment
 * for the same limitation) — testing the function directly with synthetic
 * heights is the only way to pin its actual behavior.
 *
 * Regression coverage for "Improve Profile-template pagination"
 * (RABBIT_NOTEBOOK.md), reproducing Alex_Johnson (21).pdf: a short
 * References section (a heading + two entries) previously split across
 * pages whenever only the SECOND entry didn't fit — the heading and first
 * entry stayed on page 1, the second entry landed alone on page 2 with no
 * heading, marked `showHeading: false` from `withSectionHeadingFlags` and
 * never re-evaluated per page.
 */

const HEADING_H = 20;
const PAGE_CONTENT_H = 700;
const CONTINUATION_HEADER_H = 40;

function block(id: string, sectionTitle: string): Block {
  return { id, sectionTitle, node: null as unknown as React.ReactElement };
}

function items(specs: Array<[id: string, section: string]>): Array<{
  block: Block;
  showHeading: boolean;
}> {
  let last: string | null = null;
  return specs.map(([id, section]) => {
    const showHeading = section !== last;
    last = section;
    return { block: block(id, section), showHeading };
  });
}

describe('packColumn — short-section keep-together (RABBIT_NOTEBOOK.md pagination regression)', () => {
  it('keeps a short References heading + both entries together on page 2, instead of splitting the second entry off alone', () => {
    // Page 1 already has 650 of 700 units used (a long Employment section,
    // simulated as one pre-existing block) — only 50 units left. Heading
    // (20) + entry1 (100) + entry2 (100) = 220, doesn't fit in the 50
    // remaining, but easily fits on an entire fresh page (700).
    const heights = new Map<string, number>([
      ['work-1', 650],
      ['ref-1', 100],
      ['ref-2', 100],
    ]);
    const theItems = items([
      ['work-1', 'Employment'],
      ['ref-1', 'References'],
      ['ref-2', 'References'],
    ]);

    const pages = packColumn(
      theItems,
      heights,
      HEADING_H,
      0,
      CONTINUATION_HEADER_H,
      PAGE_CONTENT_H,
    );

    expect(pages.length).toBe(2);
    expect(pages[0]!.items.map((i) => i.block.id)).toEqual(['work-1']);
    expect(pages[1]!.items.map((i) => i.block.id)).toEqual(['ref-1', 'ref-2']);
    // The heading renders with entry 1; entry 2 must NOT be flagged
    // "continued" — it's a normal, second block of a section whose
    // heading is right there on the same page, not a stranded orphan.
    expect(pages[1]!.items[0]!.showHeading).toBe(true);
    expect(pages[1]!.items[1]!.showHeading).toBe(false);
    expect(pages[1]!.items[1]!.continued).toBeFalsy();
  });

  it('leaves a short section that already fits on the current page exactly where it is (no unnecessary page break)', () => {
    const heights = new Map<string, number>([
      ['work-1', 200],
      ['ref-1', 100],
      ['ref-2', 100],
    ]);
    const theItems = items([
      ['work-1', 'Employment'],
      ['ref-1', 'References'],
      ['ref-2', 'References'],
    ]);

    const pages = packColumn(
      theItems,
      heights,
      HEADING_H,
      0,
      CONTINUATION_HEADER_H,
      PAGE_CONTENT_H,
    );

    expect(pages.length).toBe(1);
    expect(pages[0]!.items.map((i) => i.block.id)).toEqual(['work-1', 'ref-1', 'ref-2']);
  });

  it('splits a References list too long to ever fit on one page safely between entries, flagging the block that resumes on a new page as "continued"', () => {
    // 20 entries at 60 units each + a 20-unit heading = 1220, comfortably
    // longer than one 700-unit page — this section can NEVER be kept
    // together as a whole unit, so it must fall through to ordinary
    // per-block placement and split safely.
    const specs: Array<[string, string]> = Array.from({ length: 20 }, (_, i) => [
      `ref-${i}`,
      'References',
    ]);
    const heights = new Map<string, number>(specs.map(([id]) => [id, 60]));
    const theItems = items(specs);

    const pages = packColumn(
      theItems,
      heights,
      HEADING_H,
      0,
      CONTINUATION_HEADER_H,
      PAGE_CONTENT_H,
    );

    expect(pages.length).toBeGreaterThan(1);
    // Every entry appears exactly once, across all pages combined.
    const allIds = pages.flatMap((p) => p.items.map((i) => i.block.id));
    expect(allIds.length).toBe(20);
    expect(new Set(allIds).size).toBe(20);
    // The heading rides with the very first entry, on page 1.
    expect(pages[0]!.items[0]!.showHeading).toBe(true);
    expect(pages[0]!.items[0]!.continued).toBeFalsy();
    // At least one LATER page's first item must be flagged `continued`
    // (it has no heading of its own on that page) — this is exactly what
    // lets the caller render "References — continued" instead of showing
    // that entry with no heading/context at all.
    const laterPagesFirstItems = pages.slice(1).map((p) => p.items[0]!);
    expect(laterPagesFirstItems.some((i) => i.continued === true)).toBe(true);
    for (const first of laterPagesFirstItems) {
      expect(first.showHeading).toBe(false);
    }
  });

  it('does not keep-together a whole-document-spanning section unnecessarily — a normal multi-section flow that all fits is untouched', () => {
    const heights = new Map<string, number>([
      ['summary-1', 100],
      ['work-1', 150],
      ['work-2', 150],
      ['edu-1', 100],
    ]);
    const theItems = items([
      ['summary-1', 'Profile'],
      ['work-1', 'Employment'],
      ['work-2', 'Employment'],
      ['edu-1', 'Education'],
    ]);

    const pages = packColumn(
      theItems,
      heights,
      HEADING_H,
      0,
      CONTINUATION_HEADER_H,
      PAGE_CONTENT_H,
    );

    expect(pages.length).toBe(1);
    expect(pages[0]!.items.map((i) => i.block.id)).toEqual([
      'summary-1',
      'work-1',
      'work-2',
      'edu-1',
    ]);
    expect(pages[0]!.items.every((i) => !i.continued)).toBe(true);
  });
});
