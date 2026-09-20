'use client';

import { Fragment, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ProfileCap,
  ProfileContinuationHeader,
  SectionHeading,
  SkillItem,
  LanguageItem,
  QualityItem,
  WorkEntryItem,
  EducationEntryItem,
  CertificationItem,
  ReferenceEntryItem,
  ReferencesAvailableItem,
  SummaryItem,
  computeContactRowFontSizes,
  getPersonalDetailsRows,
  partitionSections,
  resolveSectionOrder,
  applyProfileDensity,
  estimateProfileDensity,
  buildProfileCss,
  PROFILE_TEMPLATE,
  A4_WIDTH_PT,
  A4_HEIGHT_PT,
  type CvContent,
  type CvSection,
} from '@cvpilot/shared';

/**
 * Profile-only preview: real, MEASURED multi-page pagination — not an
 * approximation. Replaces the earlier version's dashed-line-over-a-single-
 * scrolling-flow (which only marked where a boundary fell in one
 * continuous layout) with an actual port of profile-pdf-renderer.ts's own
 * pagination algorithm (independent sidebar/main cursors, a shared
 * continuation page once a column moves past page 1 — see that module's
 * own doc comment), driven by this content's real DOM-rendered heights
 * rather than PDFKit's font metrics (the browser has no access to those).
 * Scoped to Profile — the other 6 templates keep CvBuilderWorkspace.tsx's
 * original generic preview card untouched.
 *
 * Two fixes this pass makes over the previous version:
 *
 * 1. FIXED-WIDTH content + `transform: scale()`, not a percentage-width
 *    box. The previous version let `.cv-profile-doc` size itself to
 *    whatever percentage of the (possibly narrower-than-210mm) page box
 *    it was given — column widths (`flex: 0 0 33%`) shrink with that box,
 *    but every `pt`-based value inside (font sizes, padding, gaps) is an
 *    ABSOLUTE CSS unit that does NOT shrink with it, so on any pane
 *    narrower than a true 210mm the typography/margins were already
 *    silently disproportionate to the visible page — not actually
 *    "consistent... margins, column widths, typography" the way the PDF
 *    is. This renders `.cv-profile-doc` at its real, fixed 595.28pt
 *    (A4_WIDTH_PT) width ALWAYS — identical proportions to the PDF at
 *    every pane size — then scales the whole rendered page down to fit
 *    via `transform: scale()`. This also makes DOM measurement reliable:
 *    `offsetHeight` on a `transform`-scaled subtree is unaffected by the
 *    transform (it's a layout property; transform is paint-only), so
 *    every height read below is a real, un-scaled, directly PX↔PT-
 *    convertible number regardless of the visible zoom level.
 * 2. Real per-item pagination. A hidden "measurement" pass renders every
 *    placeable unit — the cap, Personal Details (kept atomic, like both
 *    renderers effectively treat it), each individual skill/language/
 *    quality row, the Summary paragraph (atomic), and each individual
 *    work/education/certification/reference entry (atomic — PDFKit's own
 *    `ensureSpace` is called once per entry too, so entries are never
 *    split mid-entry in the real PDF either) — then measures each one's
 *    real rendered height and runs the same bin-packing algorithm
 *    profile-pdf-renderer.ts uses to decide what lands on which page,
 *    before the VISIBLE paginated output is rendered.
 *
 * Honest limits, disclosed rather than silently smoothed over:
 * - Heights come from the BROWSER's own font rendering, not PDFKit's font
 *   metrics. For the same text/size these are normally very close but not
 *   guaranteed byte-identical, so an item sitting exactly on a page
 *   boundary could in rare cases land one page earlier/later here than in
 *   the real PDF. The STRUCTURE (independent columns, a shared
 *   continuation page, continuation header, atomic entries) is a faithful
 *   port either way.
 * - Personal Details is always placed on page 1 (never itself split or
 *   pushed later) — realistically it's a handful of short rows and PDFKit
 *   in practice never splits it either; this avoids a disproportionate
 *   amount of pagination bookkeeping for a case that doesn't occur.
 * - PDFKit only tints the FIRST page's sidebar background (its pale rect
 *   is drawn once, before pagination, bled to the true page edges — see
 *   buildProfileCss's `cvpf-sidebar-first` rule, which now matches that
 *   bleed exactly, RABBIT_NOTEBOOK.md §25); this preview additionally
 *   tints every LATER page that still shows sidebar content (its own,
 *   ordinary margin-inset background, not bled — PDFKit's continuation
 *   pages are plain white), which reads better for a continuous
 *   two-column continuation and is a deliberate, minor, disclosed
 *   deviation — not an attempt at pixel parity there.
 * - A single flow (the measurement pass) briefly exists in the DOM on
 *   mount/content change before pagination is computed and the visible
 *   paginated view is shown — expected for a "measure then lay out" UI.
 */

const PT_TO_PX = 4 / 3; // CSS's fixed pt→px ratio (96dpi / 72pt-per-inch) — independent of zoom/scale.
const A4_WIDTH_PX = A4_WIDTH_PT * PT_TO_PX;
const A4_HEIGHT_PX = A4_HEIGHT_PT * PT_TO_PX;

export interface Block {
  id: string;
  sectionTitle: string;
  node: React.ReactElement;
}

function buildSidebarBlocks(content: CvContent, sidebarSections: CvSection[]): Block[] {
  const blocks: Block[] = [];
  for (const section of sidebarSections) {
    if (section === 'skills') {
      for (const s of content.skills) {
        const id = `skill-${s.id}`;
        blocks.push({ id, sectionTitle: 'Skills', node: <SkillItem key={id} entry={s} /> });
      }
    } else if (section === 'languages') {
      for (const l of content.languages) {
        const id = `lang-${l.id}`;
        blocks.push({ id, sectionTitle: 'Languages', node: <LanguageItem key={id} entry={l} /> });
      }
    }
  }
  for (const [i, q] of (content.qualities ?? []).entries()) {
    const id = `quality-${i}`;
    blocks.push({ id, sectionTitle: 'Qualities', node: <QualityItem key={id} text={q} /> });
  }
  return blocks;
}

function buildMainBlocks(content: CvContent, mainSections: CvSection[]): Block[] {
  const blocks: Block[] = [];
  for (const section of mainSections) {
    if (section === 'summary') {
      if (content.summary) {
        blocks.push({
          id: 'summary',
          sectionTitle: 'Profile',
          node: <SummaryItem key="summary" text={content.summary} />,
        });
      }
    } else if (section === 'workExperience') {
      for (const e of content.workExperience) {
        const id = `work-${e.id}`;
        blocks.push({ id, sectionTitle: 'Employment', node: <WorkEntryItem key={id} entry={e} /> });
      }
    } else if (section === 'education') {
      for (const e of content.education) {
        const id = `edu-${e.id}`;
        blocks.push({
          id,
          sectionTitle: 'Education',
          node: <EducationEntryItem key={id} entry={e} />,
        });
      }
    } else if (section === 'certifications') {
      for (const c of content.certifications) {
        const id = `cert-${c.id}`;
        blocks.push({
          id,
          sectionTitle: 'Certifications',
          node: <CertificationItem key={id} entry={c} />,
        });
      }
    } else if (section === 'references') {
      if (content.referencesAvailableUponRequest) {
        blocks.push({
          id: 'ref-available',
          sectionTitle: 'References',
          node: <ReferencesAvailableItem key="ref-available" />,
        });
      } else {
        for (const r of content.references ?? []) {
          const id = `ref-${r.id}`;
          blocks.push({
            id,
            sectionTitle: 'References',
            node: <ReferenceEntryItem key={id} entry={r} />,
          });
        }
      }
    }
  }
  return blocks;
}

export interface PageColumn {
  items: Array<{ block: Block; showHeading: boolean; continued?: boolean }>;
}

/** Flags each block with whether it's the first of a new section, in
 *  original (unpaginated) order — the single source of truth both
 *  `packColumn` (deciding when to also reserve `headingH`) and the hidden
 *  measurement pass (rendering the same grouped/headed structure
 *  `SidebarColumnItems` uses for display, so a section's real first item —
 *  and its CSS `:first-child` zero-margin — lands in the same place during
 *  measurement as it will when actually shown) read from, so the two can
 *  never independently drift out of sync with each other again. */
function withSectionHeadingFlags(blocks: Block[]): Array<{ block: Block; showHeading: boolean }> {
  let lastSectionTitle: string | null = null;
  return blocks.map((block) => {
    const showHeading = block.sectionTitle !== lastSectionTitle;
    lastSectionTitle = block.sectionTitle;
    return { block, showHeading };
  });
}

/** Packs a flat, ordered, already-headed item list onto pages using each
 *  block's measured height, mirroring profile-pdf-renderer.ts's
 *  ensureSpace: a block that doesn't fit in the remaining space (but would
 *  fit on a fresh page) moves to the next page; every page after the first
 *  reserves `continuationHeaderH` at its own top before any block content.
 *  `showHeading` comes from `withSectionHeadingFlags` — a section that
 *  continues onto a later page correctly keeps `showHeading: false` for
 *  its continuing items (no heading repeats), matching profile-pdf-
 *  renderer.ts's own behaviour.
 *
 *  Two refinements (RABBIT_NOTEBOOK.md, References/continuation
 *  pagination), mirroring profile-pdf-renderer.ts's own equivalents
 *  exactly (measureReferencesHeight / the `ensureSpace(totalH)` whole-
 *  section check / the "— continued" marker there):
 *  1. Keep-together for short sections: when a NEW section begins (its
 *     first block), this sums that section's WHOLE remaining height
 *     (heading + every one of its own blocks, up to the next section) and
 *     checks whether it would fit on a single FRESH page. If so, and it
 *     doesn't fit in the current page's remaining room, the WHOLE section
 *     moves together — not just the block that triggered the check —
 *     instead of starting here and stranding a later block of the SAME
 *     section alone on the next page with no heading (the reported bug: a
 *     short two-entry References section). A section too long to ever fit
 *     on one page is deliberately excluded from this — it falls through
 *     to the per-block placement below unchanged, which still keeps a
 *     heading with its own first block via `needed`.
 *  2. Continuation marker: a block that lands as the first item on its
 *     OWN page but whose `showHeading` is false (a section that had to
 *     split, per #1's own exclusion) is flagged `continued: true` so the
 *     caller renders "<Section> — continued" instead of silently showing
 *     it with no heading/context at all — the exact bug this fixes. Its
 *     own `headingH` is added to `y` alongside it, so later items on that
 *     same page are positioned accounting for the marker's real height
 *     too, not just the block's own. */
export function packColumn(
  items: Array<{ block: Block; showHeading: boolean }>,
  heights: Map<string, number>,
  headingH: number,
  firstPageStartY: number,
  continuationHeaderH: number,
  pageContentH: number,
): PageColumn[] {
  const pages: PageColumn[] = [{ items: [] }];
  let pageIndex = 0;
  let y = firstPageStartY;

  for (let i = 0; i < items.length; i++) {
    const current = items[i];
    if (!current) continue;
    const { block, showHeading } = current;
    const h = heights.get(block.id) ?? 0;

    if (showHeading) {
      let sectionTotal = headingH + h;
      for (let j = i + 1; j < items.length; j++) {
        const next = items[j];
        if (!next || next.showHeading) break;
        sectionTotal += heights.get(next.block.id) ?? 0;
      }
      const sectionPageStart = pageIndex === 0 ? firstPageStartY : continuationHeaderH;
      const sectionRoomLeft = pageContentH - y;
      if (sectionTotal <= pageContentH - sectionPageStart && sectionTotal > sectionRoomLeft) {
        pageIndex += 1;
        pages.push({ items: [] });
        y = continuationHeaderH;
      }
    }

    const needed = h + (showHeading ? headingH : 0);
    const pageStart = pageIndex === 0 ? firstPageStartY : continuationHeaderH;
    const roomLeft = pageContentH - y;
    let continued = false;
    if (needed > roomLeft && needed <= pageContentH - pageStart) {
      pageIndex += 1;
      pages.push({ items: [] });
      y = continuationHeaderH;
      continued = !showHeading;
    }
    const currentPage = pages[pageIndex];
    if (!currentPage) throw new Error('unreachable: page just pushed for this index');
    currentPage.items.push({ block, showHeading, continued });
    y += needed + (continued ? headingH : 0);
  }

  return pages;
}

function SidebarColumnItems({ page }: { page: PageColumn | undefined }) {
  if (!page) return null;
  const groups: Array<{
    title: string;
    heading: boolean;
    continued: boolean;
    items: React.ReactElement[];
  }> = [];
  for (const { block, showHeading, continued } of page.items) {
    const last = groups[groups.length - 1];
    if (last && last.title === block.sectionTitle) {
      last.items.push(block.node);
    } else {
      groups.push({
        title: block.sectionTitle,
        heading: showHeading,
        continued: !!continued,
        items: [block.node],
      });
    }
  }
  return (
    <>
      {groups.map((g) => (
        <div key={g.title}>
          {g.heading && <SectionHeading title={g.title} />}
          {/* Fix (RABBIT_NOTEBOOK.md, References/continuation pagination):
              a section too long to keep together (see packColumn's own
              doc comment) splits between blocks — this labels whichever
              later page it resumes on, instead of showing that block with
              no heading/context at all. */}
          {g.continued && <SectionHeading title={`${g.title} — continued`} />}
          <ul className={g.title === 'Qualities' ? 'cvpf-qualities' : 'cvpf-rated-list'}>
            {g.items}
          </ul>
        </div>
      ))}
    </>
  );
}

function MainColumnItems({ page }: { page: PageColumn | undefined }) {
  if (!page) return null;
  return (
    <>
      {page.items.map(({ block, showHeading, continued }) => (
        // Fragment, NOT a wrapping element: `.cvpf-entry`'s CSS
        // (`:first-child` gets a smaller margin-top than the normal
        // between-entries gap) depends on its REAL DOM sibling position
        // inside `.cvpf-main` — a `<span>`/`<div>` wrapper around each
        // entry would make every entry "first-child of its own wrapper",
        // breaking that rule for every entry after the true first one.
        <Fragment key={block.id}>
          {showHeading && <SectionHeading title={block.sectionTitle} />}
          {/* Fix (RABBIT_NOTEBOOK.md, References/continuation pagination):
              see packColumn's own doc comment — a block that had to split
              away from its section's heading gets this marker instead of
              rendering with no heading/context at all (the reported bug:
              a References entry stranded alone on a later page). */}
          {continued && <SectionHeading title={`${block.sectionTitle} — continued`} />}
          {block.node}
        </Fragment>
      ))}
    </>
  );
}

export function ProfileA4Preview({
  content,
  photoUrl,
}: {
  content: CvContent;
  photoUrl?: string | null;
}) {
  const density = useMemo(
    () => estimateProfileDensity(content, PROFILE_TEMPLATE, !!photoUrl),
    [content, photoUrl],
  );
  const template = useMemo(() => applyProfileDensity(PROFILE_TEMPLATE, density), [density]);
  const css = useMemo(() => buildProfileCss(template), [template]);

  const order = useMemo(() => resolveSectionOrder(content.sectionOrder), [content.sectionOrder]);
  const { sidebar: sidebarSections, main: mainSections } = useMemo(
    () => partitionSections(order, PROFILE_TEMPLATE.sidebarSections ?? []),
    [order],
  );

  const pdRows = useMemo(
    () => getPersonalDetailsRows(content.personalDetails),
    [content.personalDetails],
  );
  const sidebarBlocks = useMemo(
    () => buildSidebarBlocks(content, sidebarSections),
    [content, sidebarSections],
  );
  const mainBlocks = useMemo(() => buildMainBlocks(content, mainSections), [content, mainSections]);
  // Computed once and reused by both the hidden measurement pass's JSX
  // (below) and the pagination call in the layout effect, so they can
  // never disagree about which item starts a new section.
  const sidebarItemsWithHeadingFlags = useMemo(
    () => withSectionHeadingFlags(sidebarBlocks),
    [sidebarBlocks],
  );
  const mainItemsWithHeadingFlags = useMemo(
    () => withSectionHeadingFlags(mainBlocks),
    [mainBlocks],
  );

  const pageWidthRef = useRef<HTMLDivElement>(null);
  const capMeasureRef = useRef<HTMLDivElement>(null);
  const pdMeasureRef = useRef<HTMLDivElement>(null);
  const pdListRef = useRef<HTMLUListElement>(null);
  const sidebarListMeasureRef = useRef<HTMLDivElement>(null);
  const mainListMeasureRef = useRef<HTMLDivElement>(null);
  const continuationHeaderRef = useRef<HTMLDivElement>(null);
  const headingMeasureRef = useRef<HTMLDivElement>(null);

  const [scale, setScale] = useState(1);
  const [pages, setPages] = useState<{ sidebar: PageColumn[]; main: PageColumn[] } | null>(null);
  const [pdSizes, setPdSizes] = useState<Map<string, number>>(new Map());

  useLayoutEffect(() => {
    const pageEl = pageWidthRef.current;
    if (!pageEl) return;
    const recomputeScale = () => {
      const widthPx = pageEl.clientWidth;
      if (widthPx) setScale(widthPx / A4_WIDTH_PX);
    };
    recomputeScale();
    const ro = new ResizeObserver(recomputeScale);
    ro.observe(pageEl);
    return () => ro.disconnect();
  }, []);

  useLayoutEffect(() => {
    const capEl = capMeasureRef.current;
    const pdEl = pdMeasureRef.current;
    const sidebarListEl = sidebarListMeasureRef.current;
    const mainListEl = mainListMeasureRef.current;
    const contEl = continuationHeaderRef.current;
    const headingEl = headingMeasureRef.current;
    if (!capEl || !headingEl || !contEl || !sidebarListEl || !mainListEl) return;

    const heights = new Map<string, number>();
    // Fix: this used to read each sidebar block's bare `offsetHeight` off
    // `sidebarListEl`'s DIRECT CHILDREN, which assumed the measurement
    // pass rendered one bare, unwrapped node per block — true before this
    // fix, but `offsetHeight` never includes CSS margin, and the real
    // visible sidebar's per-item spacing (`.cvpf-rated-list li`'s 7pt /
    // `.cvpf-qualities li`'s 5pt margin-top, `.cvpf-rated-list`/
    // `.cvpf-qualities`' own 8pt top margin) only applies through the real
    // `<ul class="cvpf-rated-list">`/`<ul class="cvpf-qualities">` wrapper
    // `SidebarColumnItems` uses for display — a wrapper the OLD bare-list
    // measurement markup never had. That undercounted every sidebar
    // block's true footprint, so `packColumn` below packed materially more
    // onto page 1 than the real page actually has room for, and the
    // overflow was silently clipped by the page box's own
    // `overflow: hidden` (invisible to a real viewer, even though the
    // block was still present in the DOM) — see RABBIT_NOTEBOOK.md §23.
    //
    // Fixed by rendering the measurement pass's sidebar through the exact
    // same `SidebarColumnItems` component the visible page uses (below,
    // fed the FULL unpaginated block list via `sidebarItemsWithHeadingFlags`)
    // instead of a bare block list — so it carries the real `<ul>` wrappers
    // and section grouping, and a future markup change to
    // `SidebarColumnItems` is automatically reflected in measurement too,
    // instead of two hand-kept-in-sync copies drifting apart again. Height
    // is then read directly off each real, correctly-wrapped `<li>`,
    // including its OWN computed `margin-top` (which — since it comes from
    // the actual CSS cascade, not a hardcoded pt value copied out of
    // buildProfileCss — stays correct even if that spacing ever changes).
    // `<li>`s are queried in DOM order, which matches `sidebarBlocks`'
    // order 1:1 (SkillItem/LanguageItem/QualityItem each render exactly
    // one top-level `<li>`, and grouping only batches consecutive
    // same-section blocks together without reordering them).
    Array.from(sidebarListEl.querySelectorAll('li')).forEach((li, i) => {
      const block = sidebarBlocks[i];
      if (!block) return;
      const marginTopPx = parseFloat(getComputedStyle(li).marginTop) || 0;
      heights.set(block.id, li.offsetHeight + marginTopPx);
    });
    Array.from(mainListEl.children).forEach((child, i) => {
      const block = mainBlocks[i];
      if (block) heights.set(block.id, (child as HTMLElement).offsetHeight);
    });

    const marginTopPx = template.margins.top * PT_TO_PX;
    const marginBottomPx = template.margins.bottom * PT_TO_PX;
    const pageContentH = A4_HEIGHT_PX - marginTopPx - marginBottomPx;
    const headingH = headingEl.offsetHeight;
    const continuationHeaderH = contEl.offsetHeight;
    const capH = capEl.offsetHeight;
    const pdH = pdRows.length ? (pdEl?.offsetHeight ?? 0) : 0;

    // Same shrink-to-fit sizing profile-pdf-renderer.ts's
    // renderPersonalDetails uses (computeContactRowFontSizes is the exact
    // shared function both call) — measured against this row list's real
    // rendered width, so an email like "alex.johnson@university.ac.uk"
    // stays on one line here too, matching the PDF, instead of wrapping.
    //
    // Fix: this used to read `pdEl.clientWidth` — `pdEl` is
    // `.cvpf-sidebar-body`, which has its own 12pt left/right padding.
    // `clientWidth` INCLUDES an element's own padding (it's the padding-
    // box width, not the content-box width), so subtracting only the icon+
    // gap left the row's own ~43px of horizontal padding still counted as
    // "available for text" — the shrink decision was computed against a
    // box about 21% wider than the text actually has room for, so a
    // borderline-long email like this one was wrongly judged "already
    // fits" and never shrunk, then overflowed the real (narrower) row.
    // Measuring `pdListRef` (the `<ul>` itself, whose own `padding: 0` per
    // buildProfileCss's `.cvpf-pd-list` rule) instead sidesteps needing to
    // separately look up and subtract computed padding — same approach
    // already used correctly by profile-document.tsx's own
    // PersonalDetailsBlock, which measures its equivalent zero-padding
    // `<ul>` directly for exactly this reason.
    const pdListEl = pdListRef.current;
    if (pdListEl && pdRows.length) {
      const iconAndGapPx = ((10 + 6) * 96) / 72; // .cvpf-icon width (10pt) + li's gap (6pt)
      const availableWidthPx = pdListEl.clientWidth - iconAndGapPx;
      setPdSizes(
        computeContactRowFontSizes(
          // Fix (RABBIT_NOTEBOOK.md, "Improve LinkedIn address rendering"):
          // the LinkedIn row (`wrap: true`, see getPersonalDetailsRows) is
          // excluded here — it wraps across lines instead of shrinking, so
          // it never needs (and must not get) a shrink-to-fit size.
          pdRows.filter((r) => !r.wrap).map((r) => ({ key: r.key, text: r.text })),
          availableWidthPx,
          template.typography.bodySize - 0.6,
        ),
      );
    }

    const sidebarPages = packColumn(
      sidebarItemsWithHeadingFlags,
      heights,
      headingH,
      capH + pdH,
      continuationHeaderH,
      pageContentH,
    );
    const mainPages = packColumn(
      mainItemsWithHeadingFlags,
      heights,
      headingH,
      0,
      continuationHeaderH,
      pageContentH,
    );

    setPages({ sidebar: sidebarPages, main: mainPages });
  }, [
    content,
    photoUrl,
    template,
    pdRows,
    sidebarBlocks,
    mainBlocks,
    sidebarItemsWithHeadingFlags,
    mainItemsWithHeadingFlags,
  ]);

  const totalPages = pages ? Math.max(pages.sidebar.length, pages.main.length, 1) : 1;
  const sidebarLastPageIndex = pages ? pages.sidebar.length - 1 : 0;
  const candidateName = content.personalDetails.fullName || 'CV';

  return (
    <div ref={pageWidthRef} className="mx-auto w-full" style={{ maxWidth: '210mm' }}>
      <style dangerouslySetInnerHTML={{ __html: css }} />

      {/* Hidden measurement pass: real fixed-width (A4_WIDTH_PT) layout,
          positioned off-screen (not display:none, so it still lays out
          and measures correctly). Re-rendered whenever content/photo/tier
          changes; read once via the useLayoutEffect above, before the
          visible paginated pages below are shown. */}
      <div
        aria-hidden="true"
        style={{ position: 'absolute', top: 0, left: '-99999px', width: `${A4_WIDTH_PT}pt` }}
      >
        {/* Reuses the REAL .cvpf-sidebar/.cvpf-main/.cvpf-sidebar-body
            classes (not manually-approximated widths) so every item is
            measured at its exact real column width/padding — including
            text wrapping inside a long skill/language name — not an
            approximation of it.
            Fix: this used to zero `.cv-profile-doc`'s own padding (the
            page margin) here, reasoning it was "irrelevant to measuring
            individual content blocks" — true for HEIGHT (a parent's
            padding doesn't change a child's own offsetHeight) but wrong
            for WIDTH: `.cvpf-sidebar`'s `flex: 0 0 33%` resolves against
            `.cv-profile-doc`'s own CONTENT width, so zeroing its padding
            made the measured sidebar wider than the real page's (which
            keeps the real 40pt page margin, per buildProfileCss), and
            every width-dependent measurement here — including
            computeContactRowFontSizes's shrink-to-fit decision for a long
            email — was computed against that too-generous width.
            Observed: an email judged "fits, no shrink needed" here still
            overflowed the real, correctly-margined sidebar. Leaving the
            real CSS class's own padding in place (no override) is the
            fix — this measurement pass now has the exact same available
            width as the visible page, for every block, not just contact
            rows. */}
        <div className="cv-profile-doc">
          {/* `cvpf-columns` — .cv-profile-doc is now a flex-COLUMN stack
              (RABBIT_NOTEBOOK.md §25, see buildProfileCss's own doc
              comment), so .cvpf-sidebar/.cvpf-main's own `flex: 0 0 X%`
              WIDTH rules only make sense inside a flex-ROW ancestor — this
              wrapper is that row, matching the real visible page's own
              structure exactly (below) so width-dependent measurements
              here (skill/language wrapping, contact-row shrink-to-fit,
              ...) stay accurate. */}
          <div className="cvpf-columns">
            {/* `cvpf-sidebar-first` — this pass always measures the cap (page
              1's shape), so its class set matches the real page 1 render
              exactly (buildProfileCss's `::before` bleed rule is purely
              decorative/paint-only and doesn't affect any measured
              width/height either way, but keeping the classes identical
              avoids the hidden pass silently drifting from what page 1
              actually renders). */}
            <div className="cvpf-sidebar cvpf-sidebar-first">
              <div ref={capMeasureRef}>
                <ProfileCap pd={content.personalDetails} photoUrl={photoUrl} />
              </div>
              {pdRows.length > 0 && (
                <div
                  ref={pdMeasureRef}
                  className="cvpf-sidebar-body"
                  style={{ padding: '0 12pt 0 0' }}
                >
                  <SectionHeading title="Personal Details" />
                  <ul className="cvpf-pd-list" ref={pdListRef}>
                    {pdRows.map((r) => (
                      <li key={r.key}>
                        {r.icon}
                        <span
                          style={{
                            fontSize: pdSizes.has(r.key) ? `${pdSizes.get(r.key)}pt` : undefined,
                            // Fix (RABBIT_NOTEBOOK.md, "Improve LinkedIn
                            // address rendering"): the LinkedIn row wraps
                            // instead of staying single-line — kept in sync
                            // with the visible page's own identical block
                            // below (measurement-pass parity, §23/§24/§38/§39).
                            whiteSpace: r.wrap ? 'normal' : 'nowrap',
                          }}
                        >
                          {r.node}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <div
                ref={sidebarListMeasureRef}
                className="cvpf-sidebar-body"
                style={{ padding: '0 12pt 0 0' }}
              >
                {/* Reuses SidebarColumnItems — the exact component the
                  visible page renders below — fed the FULL, unpaginated
                  block list (one "page" holding everything) so every real
                  `<ul class="cvpf-rated-list">`/`<ul class="cvpf-qualities">`
                  wrapper and section heading is present here too, and the
                  per-item CSS margin read off these elements in the layout
                  effect above is the real one, not an approximation. See
                  that effect's own comment for the bug this fixes. */}
                <SidebarColumnItems page={{ items: sidebarItemsWithHeadingFlags }} />
              </div>
            </div>
            <div className="cvpf-main">
              <div ref={mainListMeasureRef}>{mainBlocks.map((b) => b.node)}</div>
              <div ref={continuationHeaderRef}>
                <ProfileContinuationHeader name={candidateName} />
              </div>
              <div ref={headingMeasureRef}>
                <SectionHeading title="Measure" />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Visible, paginated output — one real A4 page box per computed
          page, stacked with a small gap between them. */}
      <div className="flex flex-col" style={{ gap: '10mm' }}>
        {Array.from({ length: totalPages }, (_, pageIndex) => {
          const sidebarPage = pages?.sidebar[pageIndex];
          const mainPage = pages?.main[pageIndex];
          const sidebarStillActive = pageIndex <= sidebarLastPageIndex;
          const isFirstPage = pageIndex === 0;
          const scaledHeight = A4_HEIGHT_PX * scale;

          return (
            <div
              key={pageIndex}
              className="mx-auto overflow-hidden rounded bg-white shadow-sm"
              style={{ width: `${A4_WIDTH_PX * scale}px`, height: `${scaledHeight}px` }}
            >
              <div
                className="relative"
                style={{
                  width: `${A4_WIDTH_PT}pt`,
                  height: `${A4_HEIGHT_PT}pt`,
                  transform: `scale(${scale})`,
                  transformOrigin: 'top left',
                }}
              >
                {totalPages > 1 && (
                  <span className="absolute right-1 top-1 z-10 rounded bg-white px-1 text-[9px] font-medium text-gray-500 shadow-sm">
                    Page {pageIndex + 1} of {totalPages}
                  </span>
                )}
                <div className="cv-profile-doc" style={{ minHeight: '100%' }}>
                  {/* Fix (RABBIT_NOTEBOOK.md §25): a SINGLE full-width
                      header, shared by both columns — matching
                      profile-pdf-renderer.ts's own one-per-continuation-
                      page `drawContinuationHeader` exactly — rendered once
                      here as a direct child of `.cv-profile-doc`, ABOVE
                      `.cvpf-columns` (below), which is what actually lays
                      the two columns out side by side now that
                      `.cv-profile-doc` itself is a flex-COLUMN stack — see
                      buildProfileCss's own doc comment for why a plain
                      flex-wrap line didn't work here. Replaces the
                      previous per-column headers (one inside the sidebar,
                      a separate one inside main) that showed the name
                      TWICE on any continuation page where both columns
                      still had content. */}
                  {!isFirstPage &&
                    (sidebarStillActive || (mainPage && mainPage.items.length > 0)) && (
                      <ProfileContinuationHeader name={candidateName} />
                    )}
                  <div className="cvpf-columns">
                    {/* Fix (RABBIT_NOTEBOOK.md, References/continuation
                        pagination): this column now ALWAYS renders — even
                        on a page where the sidebar has genuinely finished
                        (`sidebarStillActive` false) — so `.cvpf-main`
                        (flex: 1 1 auto) never expands to claim its width.
                        Before this fix, main content visibly jumped from
                        its aligned page-1 position to the page's own left
                        margin on any later page the sidebar had nothing
                        left to share the row with — the reported "abruptly
                        switches to the far-left margin" bug. Its own pale
                        background is suppressed (not its width/position)
                        when there's no real sidebar content, so an
                        otherwise-empty page reads as blank space there
                        rather than a tint with nothing in it — matching
                        profile-pdf-renderer.ts's own equivalent (it only
                        paints a continuation page's sidebar tint when the
                        SIDEBAR pass itself is the one reaching that page). */}
                    <div
                      className={`cvpf-sidebar ${isFirstPage ? 'cvpf-sidebar-first' : ''}`}
                      style={sidebarStillActive ? undefined : { background: 'transparent' }}
                    >
                      {sidebarStillActive && (
                        <>
                          {isFirstPage && (
                            <ProfileCap pd={content.personalDetails} photoUrl={photoUrl} />
                          )}
                          <div
                            className={`cvpf-sidebar-body ${
                              isFirstPage && photoUrl ? 'cvpf-sidebar-body-with-photo' : ''
                            }`}
                          >
                            {isFirstPage && pdRows.length > 0 && (
                              <div>
                                <SectionHeading title="Personal Details" />
                                <ul className="cvpf-pd-list">
                                  {pdRows.map((r) => (
                                    <li key={r.key}>
                                      {r.icon}
                                      <span
                                        style={{
                                          fontSize: pdSizes.has(r.key)
                                            ? `${pdSizes.get(r.key)}pt`
                                            : undefined,
                                          // Fix (RABBIT_NOTEBOOK.md, "Improve
                                          // LinkedIn address rendering"): the
                                          // LinkedIn row wraps instead of
                                          // staying single-line — see
                                          // getPersonalDetailsRows' own doc
                                          // comment (packages/shared).
                                          whiteSpace: r.wrap ? 'normal' : 'nowrap',
                                        }}
                                      >
                                        {r.node}
                                      </span>
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            )}
                            <SidebarColumnItems page={sidebarPage} />
                          </div>
                        </>
                      )}
                    </div>
                    <div className="cvpf-main">
                      <MainColumnItems page={mainPage} />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
