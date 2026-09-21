import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type {
  CvContent,
  CvSection,
  CvWorkEntry,
  CvEducationEntry,
  CvCertificationEntry,
  CvReferenceEntry,
  CvSkillEntry,
  CvLanguageEntry,
} from '../types/cv.types';
import { PROFILE_TEMPLATE, type TemplateDefinition } from './template-types';
import {
  formatDateRange,
  formatLinkedInLabel,
  normalizeExternalUrl,
  normalizeParagraph,
  shortenUrlLabel,
} from './format';
import { resolveSectionOrder } from './classic-document';
import { applyProfileDensity, estimateProfileDensity, A4_WIDTH_PT } from './profile-density';

/**
 * CV Template Foundation, Phase 7 — Profile, browser side. An asymmetric
 * two-column personal design: a pale-grey sidebar (~33%) with a muted-blue
 * "cap" carrying the candidate name and an OPTIONAL circular photo, plus a
 * wider white main column. See PROFILE_TEMPLATE's doc comment
 * (template-types.ts) for the full design rationale.
 *
 * `photoUrl`, when provided, is a short-lived, already-resolved preview URL
 * the host app fetched from its own API (see apps/web's cvApi.ts) — this
 * component only ever renders it as a plain `<img src>`, it never fetches
 * or resolves anything itself.
 */

const PROFILE_NAME_BASE_SIZE = PROFILE_TEMPLATE.typography.nameSize;
const PROFILE_NAME_FLOOR_SIZE = 14;
const PROFILE_NAME_STEP = 1.5;

// Mirrors profile-pdf-renderer.ts's own private SIDEBAR_INSET constant
// (kept independently there per this template's established per-renderer-
// file duplication trade-off — see that module's own top-of-file doc
// comment) — the sidebar's own content's purely cosmetic left inset,
// independent of the page's real left margin. Module-scoped here (not
// buildProfileCss-local) so `profileSidebarBleedWidthPt` below can use it
// too.
const PROFILE_SIDEBAR_INSET = 22;

// Mirrors profile-pdf-renderer.ts's own private CAP_PADDING_X constant —
// .cvpf-cap's own left/right padding (see its CSS rule below). Exported
// so ProfileA4Preview.tsx's name-wrap measurement (profileNameWrapWidthPt
// below) can derive the exact same text width PDFKit's drawCap does.
const PROFILE_CAP_PADDING_X = 12;

/** The exact width profile-pdf-renderer.ts's drawCap wraps the candidate
 *  NAME against (its bled capWidth minus CAP_PADDING_X on both sides) —
 *  see profileSidebarBleedWidthPt's own doc comment for why
 *  ProfileA4Preview.tsx measures against this rather than .cvpf-cap's own
 *  (deliberately narrower) rendered box width. */
export function profileNameWrapWidthPt(template: TemplateDefinition): number {
  return profileSidebarBleedWidthPt(template) - PROFILE_CAP_PADDING_X * 2;
}

// Matches profile-pdf-renderer.ts's CONTACT_TEXT_FLOOR_SIZE exactly — an
// absolute (not tier-proportional) minimum, so "keep it readable" means
// the same thing regardless of density tier in both renderers.
const CONTACT_TEXT_FLOOR_SIZE = 7.5;

/**
 * Shrink-to-fit sizing for Personal Details rows — a contact value with no
 * spaces (typically an email or a shortened URL label) has no legal wrap
 * point, so rather than let it wrap awkwardly or overflow, each row stays
 * on ONE line always: if it already fits at `baseSize`, use that;
 * otherwise shrink directly by the ratio it's short by (corrected with one
 * verifying re-measure, since canvas text metrics don't scale perfectly
 * linearly with font size) down to, but never below, `floorSize`. Uses a
 * `<canvas>` 2D context to measure — same technique as
 * useProfileNameFontSize below, and the same reason: measuring real
 * rendered text width without needing every candidate size actually
 * mounted to the DOM. Exported so both `PersonalDetailsBlock` (this file)
 * and the paginated preview (apps/web's ProfileA4Preview.tsx) compute the
 * identical sizes for the identical content, not two independently-tuned
 * approximations of the same idea.
 *
 * `fontFamily` defaults to Profile's own real CSS stack (not a hardcoded
 * "Arial") — this package has no `@font-face`/web-font loading of its own
 * (the browser preview relies entirely on whatever's installed on the
 * user's OS, resolved synchronously, unlike the PDF's embedded .ttf), so
 * the only real risk is measuring with a DIFFERENT font than what
 * actually renders. Passing the real stack lets the canvas context
 * resolve the SAME fallback chain the CSS does.
 */
export function computeContactRowFontSizes(
  rows: Array<{ key: string; text: string }>,
  availableWidthPx: number,
  baseSize: number,
  floorSize: number = CONTACT_TEXT_FLOOR_SIZE,
  fontFamily: string = PROFILE_TEMPLATE.typography.fontFamily,
): Map<string, number> {
  const sizes = new Map<string, number>();
  if (typeof document === 'undefined' || availableWidthPx <= 0) {
    for (const row of rows) sizes.set(row.key, baseSize);
    return sizes;
  }
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    for (const row of rows) sizes.set(row.key, baseSize);
    return sizes;
  }
  const toPx = (pt: number) => (pt * 96) / 72;
  for (const row of rows) {
    ctx.font = `400 ${toPx(baseSize)}px ${fontFamily}`;
    const naturalWidth = ctx.measureText(row.text).width;
    if (naturalWidth <= availableWidthPx) {
      sizes.set(row.key, baseSize);
      continue;
    }
    let size = Math.max(floorSize, baseSize * (availableWidthPx / naturalWidth));
    ctx.font = `400 ${toPx(size)}px ${fontFamily}`;
    if (ctx.measureText(row.text).width > availableWidthPx && size > floorSize) {
      size = Math.max(floorSize, size - 0.3);
    }
    sizes.set(row.key, size);
  }
  return sizes;
}

/** The actual adaptive-name-size ALGORITHM (canvas-based greedy word-wrap
 *  line-count check, same technique proven on Professional/Minimal — see
 *  their own hooks), extracted as a pure, synchronous function so it can
 *  be called from exactly one place per real measurement pass instead of
 *  living only inside a React effect.
 *
 *  Fix (RABBIT_NOTEBOOK.md §44 — preview/PDF parity investigation):
 *  `useProfileNameFontSize` below used to run this ENTIRELY inside its own
 *  `useLayoutEffect` + `setState`, called independently by EVERY mounted
 *  `ProfileCap` instance (the hidden measurement pass's copy AND the
 *  visible page's copy are two SEPARATE component instances). React fires
 *  layout effects bottom-up per commit, but a `setState` from a CHILD's
 *  layout effect does not retroactively re-run an ALREADY-EXECUTED
 *  ancestor's own layout effect in the same commit — so
 *  ProfileA4Preview.tsx's own pagination-measurement effect (a sibling-
 *  level ancestor effect, not a descendant of ProfileCap) was reading
 *  `capMeasureRef.current.offsetHeight` from the cap's FIRST-render state,
 *  i.e. BEFORE this shrink ever applied, every single time a name
 *  genuinely needed shrinking to fit — deterministically baking in the
 *  UNSHRUNK (taller, more-likely-to-wrap) cap height into pagination.
 *  Confirmed via direct measurement (RABBIT_NOTEBOOK.md §44): the hidden
 *  pass's measured name font-size was consistently the base/unshrunk
 *  28px/21pt across every real run, never the shrunk value, even for a
 *  name ("Alex Johnson") that visibly needed to shrink to stay on one
 *  line at the cap's real width — exactly matching the reported "preview
 *  wraps the name onto two lines, PDF doesn't" divergence, since PDFKit's
 *  single-pass synchronous `profileNameFontSize` has no such race by
 *  construction.
 *
 *  Extracting the algorithm lets ProfileA4Preview.tsx call it directly,
 *  synchronously, in its OWN single measurement effect — computing the
 *  correct, final size once and passing it down to EVERY `ProfileCap`
 *  instance (hidden pass and visible page alike) as an explicit prop, the
 *  same "compute once during measurement, apply everywhere" pattern this
 *  file already uses for `computeContactRowFontSizes`/`pdSizes`. This
 *  guarantees `capH` (what pagination uses) and the ACTUAL rendered cap
 *  height (what the reader sees) can never drift apart, and removes the
 *  timing dependency entirely — not just narrows the window for it. */
export function resolveProfileNameFontSize(name: string, availableWidthPx: number): number {
  if (!availableWidthPx || typeof document === 'undefined') return PROFILE_NAME_BASE_SIZE;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return PROFILE_NAME_BASE_SIZE;

  const words = name.split(/\s+/).filter(Boolean);
  let chosen = PROFILE_NAME_BASE_SIZE;
  for (
    let candidate = PROFILE_NAME_BASE_SIZE;
    candidate >= PROFILE_NAME_FLOOR_SIZE;
    candidate -= PROFILE_NAME_STEP
  ) {
    ctx.font = `700 ${(candidate * 96) / 72}px Arial`;
    let lines = 1;
    let lineWidth = 0;
    for (const word of words) {
      const wordWidth = ctx.measureText(`${word} `).width;
      if (lineWidth > 0 && lineWidth + wordWidth > availableWidthPx) {
        lines += 1;
        lineWidth = wordWidth;
      } else {
        lineWidth += wordWidth;
      }
    }
    chosen = candidate;
    if (lines <= 3) break;
  }
  return chosen;
}

/** Self-contained fallback for any consumer that renders a bare
 *  `<ProfileCap>` without a pre-resolved `nameFontSize` (see that
 *  component's own doc comment) — re-runs the same algorithm above, but
 *  through its own effect/state, carrying the exact timing caveat
 *  documented on `resolveProfileNameFontSize`. ProfileA4Preview.tsx (the
 *  one consumer that needs pagination-accurate correctness) never
 *  exercises this path — it always supplies `nameFontSize` explicitly. */
function useProfileNameFontSize(
  name: string,
): [number, React.RefObject<HTMLHeadingElement | null>] {
  const ref = useRef<HTMLHeadingElement>(null);
  const [size, setSize] = useState(PROFILE_NAME_BASE_SIZE);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const widthPx = el.clientWidth;
    if (!widthPx) return;
    setSize(resolveProfileNameFontSize(name, widthPx));
  }, [name]);

  return [size, ref];
}

// ─── Small, generic pictograms (never a reproduction of any brand's logo)
// — deliberately simple inline SVGs, styled to match the PDFKit renderer's
// own hand-drawn vector icons as closely as two independent rendering
// engines reasonably can. No icon-font/image dependency needed for either.

function IconEnvelope() {
  return (
    <svg viewBox="0 0 16 16" className="cvpf-icon" aria-hidden="true">
      <rect
        x="1.5"
        y="3.5"
        width="13"
        height="9"
        rx="1"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
      />
      <path d="M2 4.2L8 8.5L14 4.2" fill="none" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

function IconPhone() {
  return (
    <svg viewBox="0 0 16 16" className="cvpf-icon" aria-hidden="true">
      <rect
        x="6.7"
        y="1"
        width="3.4"
        height="12"
        rx="1.2"
        fill="currentColor"
        transform="rotate(35 8 8)"
      />
    </svg>
  );
}

function IconPin() {
  return (
    <svg viewBox="0 0 16 16" className="cvpf-icon" aria-hidden="true">
      <circle cx="8" cy="5.6" r="3.3" fill="currentColor" />
      <path d="M4.6 6.5H11.4L8 14Z" fill="currentColor" />
    </svg>
  );
}

function IconLink() {
  return (
    <svg viewBox="0 0 16 16" className="cvpf-icon" aria-hidden="true">
      <rect
        x="1.5"
        y="6.5"
        width="6"
        height="3"
        rx="1.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
      />
      <rect
        x="8.5"
        y="6.5"
        width="6"
        height="3"
        rx="1.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
      />
      <line x1="6" y1="8" x2="10" y2="8" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

function IconGlobe() {
  return (
    <svg viewBox="0 0 16 16" className="cvpf-icon" aria-hidden="true">
      <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="1.1" />
      <ellipse cx="8" cy="8" rx="2.6" ry="6" fill="none" stroke="currentColor" strokeWidth="1.1" />
      <line x1="2" y1="8" x2="14" y2="8" stroke="currentColor" strokeWidth="1.1" />
    </svg>
  );
}

function IconFlag() {
  return (
    <svg viewBox="0 0 16 16" className="cvpf-icon" aria-hidden="true">
      <line x1="3" y1="1.5" x2="3" y2="14.5" stroke="currentColor" strokeWidth="1.2" />
      <path d="M3 2.2L13 3.8L3 8Z" fill="currentColor" />
    </svg>
  );
}

function RatingDots({ rating }: { rating: number }) {
  const clamped = Math.max(1, Math.min(5, Math.round(rating)));
  return (
    <span className="cvpf-dots" role="img" aria-label={`Rated ${clamped} out of 5`}>
      {Array.from({ length: 5 }, (_, i) => (
        <span key={i} className={`cvpf-dot ${i < clamped ? 'cvpf-dot-filled' : ''}`} />
      ))}
    </span>
  );
}

/** Exported so the paginated A4 preview (apps/web's ProfileA4Preview.tsx)
 *  can render the identical heading markup/CSS class at the top of
 *  whichever page a section's first item lands on, and so a continuation
 *  page's own header (see ProfileContinuationHeader below) uses the exact
 *  same visual language as every other heading in this template. */
export function SectionHeading({ title }: { title: string }) {
  return (
    <div className="cvpf-heading">
      <h2>{title}</h2>
    </div>
  );
}

/** The sidebar's name/title/photo "cap" — extracted out of ProfileCvDocument
 *  so the paginated preview can render it once, on page 1 only (a
 *  continuation page gets ProfileContinuationHeader instead — see below —
 *  matching profile-pdf-renderer.ts's own drawCap/drawContinuationHeader
 *  split exactly).
 *
 *  `nameFontSize`, when provided, is used AS-IS (see
 *  `resolveProfileNameFontSize`'s own doc comment for why
 *  ProfileA4Preview.tsx always supplies this rather than letting this
 *  component resolve its own) — the internal `useProfileNameFontSize`
 *  hook only runs as a self-contained fallback when it's omitted. */
export function ProfileCap({
  pd,
  photoUrl,
  nameFontSize: nameFontSizeProp,
}: {
  pd: CvContent['personalDetails'];
  photoUrl?: string | null;
  nameFontSize?: number;
}) {
  const [resolvedNameFontSize, nameRef] = useProfileNameFontSize(pd.fullName || 'Your Name');
  const nameFontSize = nameFontSizeProp ?? resolvedNameFontSize;
  return (
    <div className={`cvpf-cap ${photoUrl ? 'cvpf-cap-with-photo' : ''}`}>
      <h1 ref={nameRef} style={{ fontSize: `${nameFontSize}pt` }}>
        {pd.fullName || 'Your Name'}
      </h1>
      {pd.jobTitle && <p className="cvpf-job-title">{pd.jobTitle}</p>}
      {photoUrl && (
        <div className="cvpf-photo-wrap">
          {/* Deliberately a plain <img>, not next/image — this package is
              not a Next.js app (it's also consumed by the NestJS PDF
              renderer), so plain <img> keeps the shared template
              framework-agnostic. */}
          <img src={photoUrl} alt="" className="cvpf-photo" />
        </div>
      )}
    </div>
  );
}

/** A continuation page's simple header — matches
 *  profile-pdf-renderer.ts's drawContinuationHeader (candidate name,
 *  uppercased, with a short accent rule beneath) exactly: same content,
 *  same visual language, for whichever page(s) beyond the first a sidebar
 *  or main column's own overflow lands on. See buildProfileCss for the
 *  matching `.cvpf-continuation-header` rule. */
export function ProfileContinuationHeader({ name }: { name: string }) {
  return (
    <div className="cvpf-continuation-header">
      <span>{name.toUpperCase()}</span>
    </div>
  );
}

function ContactLink({ href, label }: { href: string; label: string }) {
  const url = normalizeExternalUrl(href);
  if (!url) return <span>{label}</span>;
  return (
    <a href={url} target="_blank" rel="noreferrer">
      {label}
    </a>
  );
}

/** One Personal Details row's {icon, plain text, renderable content} —
 *  `text` (no markup) is what computeContactRowFontSizes measures;
 *  `node` is what's actually rendered. Exported so the paginated preview
 *  can measure/place this block by its real rendered rows if ever needed
 *  — Personal Details itself is still always kept atomic (one page-
 *  placement unit) by both renderers, so in practice this is rendered as
 *  a whole list, not split — exported for symmetry/future use, not
 *  because it's split today.
 *
 *  `wrap` (RABBIT_NOTEBOOK.md, "Improve LinkedIn address rendering"): true
 *  only for the LinkedIn row. Every other row stays single-line,
 *  shrink-to-fit, ellipsis-truncated exactly as before — this is
 *  deliberately scoped to LinkedIn only. A wrap row's `text` is the FULL,
 *  untruncated label (`formatLinkedInLabel`, no ellipsis) and its caller
 *  must (a) skip it when computing shrink-to-fit sizes (it doesn't need
 *  shrinking — it wraps instead) and (b) render its span without
 *  `white-space: nowrap`, letting the browser wrap it naturally within the
 *  row's existing width. Continuation lines land aligned with the first
 *  line "for free": the icon and the text span are separate flex-row
 *  items, so the text's own internal line-wrapping stays within its own
 *  column, left-aligned with itself, regardless of the icon's width. */
export function getPersonalDetailsRows(pd: CvContent['personalDetails']): Array<{
  key: string;
  icon: React.ReactNode;
  text: string;
  node: React.ReactNode;
  wrap?: boolean;
}> {
  const rows: Array<{
    key: string;
    icon: React.ReactNode;
    text: string;
    node: React.ReactNode;
    wrap?: boolean;
  }> = [];
  if (pd.email) rows.push({ key: 'email', icon: <IconEnvelope />, text: pd.email, node: pd.email });
  if (pd.phone) rows.push({ key: 'phone', icon: <IconPhone />, text: pd.phone, node: pd.phone });
  if (pd.location) {
    rows.push({ key: 'location', icon: <IconPin />, text: pd.location, node: pd.location });
  }
  if (pd.linkedIn) {
    const label = formatLinkedInLabel(pd.linkedIn);
    rows.push({
      key: 'linkedIn',
      icon: <IconLink />,
      text: label,
      node: <ContactLink href={pd.linkedIn} label={label} />,
      wrap: true,
    });
  }
  if (pd.website) {
    const label = shortenUrlLabel(pd.website, 26);
    rows.push({
      key: 'website',
      icon: <IconGlobe />,
      text: label,
      node: <ContactLink href={pd.website} label={label} />,
    });
  }
  if (pd.nationality) {
    rows.push({
      key: 'nationality',
      icon: <IconFlag />,
      text: pd.nationality,
      node: pd.nationality,
    });
  }
  return rows;
}

// Contact rows never wrap to a second line — matches
// profile-pdf-renderer.ts's renderPersonalDetails exactly (same constant
// name/value, see computeContactRowFontSizes above). `overflow-wrap:
// anywhere` remains on `.cvpf-pd-list li` in buildProfileCss purely as a
// last-resort safety net (e.g. before this effect has run on first
// paint), not as the primary wrapping mechanism.
// Fix (RABBIT_NOTEBOOK.md, "Improve LinkedIn address rendering"): the
// LinkedIn row (`r.wrap`) is the one exception — see getPersonalDetailsRows'
// own doc comment. It's excluded from the shrink-to-fit sizing pass below
// (it wraps instead of shrinking) and rendered without `white-space: nowrap`.
function PersonalDetailsBlock({
  pd,
  bodySize,
}: {
  pd: CvContent['personalDetails'];
  bodySize: number;
}) {
  const rows = getPersonalDetailsRows(pd);
  const listRef = useRef<HTMLUListElement>(null);
  const [sizes, setSizes] = useState<Map<string, number>>(new Map());
  const baseSize = bodySize - 0.6;

  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el || !rows.length) return;
    const iconAndGapPx = ((10 + 6) * 96) / 72; // .cvpf-icon width (10pt) + li's gap (6pt)
    const availableWidthPx = el.clientWidth - iconAndGapPx;
    setSizes(
      computeContactRowFontSizes(
        rows.filter((r) => !r.wrap).map((r) => ({ key: r.key, text: r.text })),
        availableWidthPx,
        baseSize,
      ),
    );
    // Deliberately NOT depending on `rows` itself — it's a freshly-built
    // array every render; keying off the row texts directly (joined below)
    // avoids re-measuring on every unrelated re-render while still
    // catching every real content change.
  }, [rows.map((r) => `${r.key}:${r.text}`).join('|'), baseSize]);

  if (!rows.length) return null;
  return (
    <div>
      <SectionHeading title="Personal Details" />
      <ul className="cvpf-pd-list" ref={listRef}>
        {rows.map((r) => (
          <li key={r.key}>
            {r.icon}
            <span
              style={{
                fontSize: sizes.has(r.key) ? `${sizes.get(r.key)}pt` : undefined,
                whiteSpace: r.wrap ? 'normal' : 'nowrap',
              }}
            >
              {r.node}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** One quality's `<li>` — exported so the paginated preview can measure
 *  and place each quality independently (a long qualities list can
 *  legitimately need to split across pages, same as skills/languages). */
export function QualityItem({ text }: { text: string }) {
  return <li>{text}</li>;
}

function QualitiesBlock({ qualities }: { qualities: string[] }) {
  if (!qualities.length) return null;
  return (
    <div>
      <SectionHeading title="Qualities" />
      <ul className="cvpf-qualities">
        {qualities.map((q, i) => (
          <QualityItem key={i} text={q} />
        ))}
      </ul>
    </div>
  );
}

/** One skill's `<li>` — exported for the same reason as QualityItem: a
 *  long skill list is this template's single most common real-world
 *  overflow case (see profile-pdf-renderer.ts's per-row `ensureSpace`),
 *  so the paginated preview needs to place skills individually, not as
 *  one atomic list, to land page breaks where the real PDF actually does. */
export function SkillItem({ entry }: { entry: CvSkillEntry }) {
  return (
    <li>
      <span className="cvpf-rated-name">
        {entry.name}
        {entry.level && !entry.rating ? (
          <span className="cvpf-rated-level"> · {entry.level}</span>
        ) : null}
      </span>
      {typeof entry.rating === 'number' && <RatingDots rating={entry.rating} />}
    </li>
  );
}

function SkillsBlock({ entries }: { entries: CvSkillEntry[] }) {
  if (!entries.length) return null;
  return (
    <div>
      <SectionHeading title="Skills" />
      <ul className="cvpf-rated-list">
        {entries.map((s) => (
          <SkillItem key={s.id} entry={s} />
        ))}
      </ul>
    </div>
  );
}

/** One language's `<li>` — same rationale as SkillItem. */
export function LanguageItem({ entry }: { entry: CvLanguageEntry }) {
  return (
    <li>
      <span className="cvpf-rated-name">
        {entry.name}
        {entry.level && !entry.rating ? (
          <span className="cvpf-rated-level"> · {entry.level}</span>
        ) : null}
      </span>
      {typeof entry.rating === 'number' && <RatingDots rating={entry.rating} />}
    </li>
  );
}

function LanguagesBlock({ entries }: { entries: CvLanguageEntry[] }) {
  if (!entries.length) return null;
  return (
    <div>
      <SectionHeading title="Languages" />
      <ul className="cvpf-rated-list">
        {entries.map((l) => (
          <LanguageItem key={l.id} entry={l} />
        ))}
      </ul>
    </div>
  );
}

/** One work-experience entry — exported so the paginated preview can place
 *  entries individually (a long work history is this template's other
 *  common overflow case, matching profile-pdf-renderer.ts's per-entry
 *  `ensureSpace`, which treats each entry as an atomic unit that either
 *  fully fits or moves whole to the next page — never split mid-entry). */
export function WorkEntryItem({ entry }: { entry: CvWorkEntry }) {
  return (
    <div className="cvpf-entry">
      <div className="cvpf-entry-row">
        <span className="cvpf-entry-title">{entry.title}</span>
        <span className="cvpf-entry-date">
          {formatDateRange(entry.startDate, entry.endDate, entry.current)}
        </span>
      </div>
      <div className="cvpf-entry-org">
        {entry.company}
        {entry.location ? <span className="cvpf-entry-loc"> · {entry.location}</span> : null}
      </div>
      {entry.bullets.length > 0 && (
        <ul className="cvpf-bullets">
          {entry.bullets.map((b, i) => (
            <li key={i}>{b}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function WorkEntries({ entries }: { entries: CvWorkEntry[] }) {
  if (!entries.length) return null;
  return (
    <>
      <SectionHeading title="Employment" />
      {entries.map((e) => (
        <WorkEntryItem key={e.id} entry={e} />
      ))}
    </>
  );
}

/** One education entry — same rationale as WorkEntryItem. */
export function EducationEntryItem({ entry }: { entry: CvEducationEntry }) {
  return (
    <div className="cvpf-entry">
      <div className="cvpf-entry-row">
        <span className="cvpf-entry-title">
          {entry.degree}
          {entry.field ? ` — ${entry.field}` : ''}
        </span>
        <span className="cvpf-entry-date">{formatDateRange(entry.startDate, entry.endDate)}</span>
      </div>
      <div className="cvpf-entry-org">
        {entry.institution}
        {entry.location ? <span className="cvpf-entry-loc"> · {entry.location}</span> : null}
      </div>
      {entry.grade && <div className="cvpf-entry-meta">Grade: {entry.grade}</div>}
    </div>
  );
}

function EducationEntries({ entries }: { entries: CvEducationEntry[] }) {
  if (!entries.length) return null;
  return (
    <>
      <SectionHeading title="Education" />
      {entries.map((e) => (
        <EducationEntryItem key={e.id} entry={e} />
      ))}
    </>
  );
}

/** One certification — same rationale as WorkEntryItem. */
export function CertificationItem({ entry }: { entry: CvCertificationEntry }) {
  return (
    <div className="cvpf-cert">
      <div className="cvpf-cert-name">{entry.name}</div>
      {(entry.issuer || entry.date) && (
        <div className="cvpf-cert-meta">
          {[entry.issuer, entry.date].filter(Boolean).join(' · ')}
        </div>
      )}
    </div>
  );
}

function CertificationsSection({ certs }: { certs: CvCertificationEntry[] }) {
  if (!certs.length) return null;
  return (
    <>
      <SectionHeading title="Certifications" />
      {certs.map((c) => (
        <CertificationItem key={c.id} entry={c} />
      ))}
    </>
  );
}

/** One reference entry — same rationale as WorkEntryItem. The "available
 *  upon request" paragraph is a separate, always-atomic unit (see
 *  ReferencesAvailableItem below), since it isn't a per-entry list at all. */
export function ReferenceEntryItem({ entry }: { entry: CvReferenceEntry }) {
  return (
    <div className="cvpf-entry">
      <div className="cvpf-entry-row">
        <span className="cvpf-entry-title">{entry.fullName}</span>
      </div>
      {(entry.jobTitle || entry.company) && (
        <div className="cvpf-entry-org">
          {[entry.jobTitle, entry.company].filter(Boolean).join(', ')}
        </div>
      )}
      {entry.relationship && <div className="cvpf-entry-meta">{entry.relationship}</div>}
      {(entry.email || entry.phone) && (
        <div className="cvpf-entry-meta">
          {[entry.email, entry.phone].filter(Boolean).join('  ·  ')}
        </div>
      )}
    </div>
  );
}

export function ReferencesAvailableItem() {
  return <p className="cvpf-summary">References available upon request.</p>;
}

function ReferencesSection({
  entries,
  availableUponRequest,
}: {
  entries: CvReferenceEntry[];
  availableUponRequest?: boolean;
}) {
  if (!entries.length && !availableUponRequest) return null;
  return (
    <>
      <SectionHeading title="References" />
      {availableUponRequest ? (
        <ReferencesAvailableItem />
      ) : (
        entries.map((r) => <ReferenceEntryItem key={r.id} entry={r} />)
      )}
    </>
  );
}

/** The Profile/Summary paragraph — exported so the paginated preview can
 *  measure and place it as its own atomic unit (matches
 *  profile-pdf-renderer.ts's single `ensureSpace` call for the whole
 *  paragraph — it's never split mid-paragraph in either renderer). */
export function SummaryItem({ text }: { text: string }) {
  return <p className="cvpf-summary">{normalizeParagraph(text)}</p>;
}

function renderMainSection(content: CvContent, section: CvSection) {
  switch (section) {
    case 'summary':
      if (!content.summary) return null;
      return (
        <div key="summary">
          <SectionHeading title="Profile" />
          <SummaryItem text={content.summary} />
        </div>
      );
    case 'workExperience':
      return <WorkEntries key="work" entries={content.workExperience} />;
    case 'education':
      return <EducationEntries key="edu" entries={content.education} />;
    case 'certifications':
      return <CertificationsSection key="certs" certs={content.certifications} />;
    case 'references':
      return (
        <ReferencesSection
          key="references"
          entries={content.references ?? []}
          availableUponRequest={content.referencesAvailableUponRequest ?? false}
        />
      );
    default:
      return null;
  }
}

function renderSidebarSection(content: CvContent, section: CvSection) {
  switch (section) {
    case 'skills':
      return <SkillsBlock key="skills" entries={content.skills} />;
    case 'languages':
      return <LanguagesBlock key="languages" entries={content.languages} />;
    default:
      return null;
  }
}

export function partitionSections(
  order: readonly CvSection[],
  sidebarSections: readonly CvSection[],
): { sidebar: CvSection[]; main: CvSection[] } {
  const sidebarSet = new Set(sidebarSections);
  return {
    sidebar: order.filter((s) => sidebarSet.has(s)),
    main: order.filter((s) => !sidebarSet.has(s)),
  };
}

export function ProfileCvDocument({
  content,
  photoUrl,
}: {
  content: CvContent;
  photoUrl?: string | null;
}) {
  const { personalDetails: pd, sectionOrder } = content;
  const order = resolveSectionOrder(sectionOrder);
  const { sidebar, main } = partitionSections(order, PROFILE_TEMPLATE.sidebarSections ?? []);
  const qualities = content.qualities ?? [];

  // Automatic spacing: the SAME density decision (see profile-density.ts's
  // own doc comment) profile-pdf-renderer.ts reaches for this exact content
  // is computed here too, so the browser preview and the PDF always choose
  // the identical tier for the identical CV — never each renderer eyeballing
  // its own "similar" adjustment. Recomputed only when content/photo
  // presence actually changes, not on every unrelated re-render.
  const densityTemplate = useMemo(() => {
    const density = estimateProfileDensity(content, PROFILE_TEMPLATE, !!photoUrl);
    return applyProfileDensity(PROFILE_TEMPLATE, density);
  }, [content, photoUrl]);
  const css = useMemo(() => buildProfileCss(densityTemplate), [densityTemplate]);

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: css }} />
      <div className="cv-profile-doc">
        {/* `cvpf-sidebar-first` — this component always renders the cap
            (never a continuation header, it has no pagination concept), so
            its sidebar tint always bleeds to the page edges the same way
            page 1 of ProfileA4Preview.tsx does — see buildProfileCss's own
            doc comment for the full geometry. */}
        <div className="cvpf-sidebar cvpf-sidebar-first">
          {/* Fix: `.cvpf-photo-wrap` (inside ProfileCap) must be a CHILD of
              `.cvpf-cap`, not a sibling after it — its `top: 100%` resolves
              against its nearest POSITIONED ancestor's height. As a
              sibling, that ancestor was `.cvpf-sidebar` (the whole column),
              so the portrait rendered at the very BOTTOM of the sidebar
              instead of anchored to the cap. */}
          <ProfileCap pd={pd} photoUrl={photoUrl} />
          <div className={`cvpf-sidebar-body ${photoUrl ? 'cvpf-sidebar-body-with-photo' : ''}`}>
            <PersonalDetailsBlock pd={pd} bodySize={densityTemplate.typography.bodySize} />
            {sidebar.map((section) => renderSidebarSection(content, section))}
            <QualitiesBlock qualities={qualities} />
          </div>
        </div>
        <div className="cvpf-main">
          {main.map((section) => renderMainSection(content, section))}
        </div>
      </div>
    </>
  );
}

/** Mirrors profile-pdf-renderer.ts's own `sidebarBleedRight` geometry
 *  exactly (SIDEBAR_INSET + the sidebar column's own content width + half
 *  the section gap) — the width the sidebar/cap BACKGROUND bleeds to on
 *  the true page edge. Exported (not just inlined in `buildProfileCss`
 *  below) so ProfileA4Preview.tsx can also use it directly — specifically
 *  to measure the cap's NAME text against the same width PDFKit's own
 *  `drawCap`/`profileNameFontSize` wraps against, without needing to
 *  actually widen `.cvpf-cap`'s own CSS box (see `.cvpf-sidebar::before`'s
 *  own doc comment below for why THAT specific change previously reopened
 *  a sidebar-clipping regression — this keeps the cap's real layout box
 *  exactly as it was, only the NAME-WRAP MEASUREMENT now uses the wider,
 *  PDFKit-equivalent width). See RABBIT_NOTEBOOK.md §44 for the
 *  measured before/after: the browser's cap box is narrower than
 *  PDFKit's by SIDEBAR_INSET + half the section gap (~27pt for
 *  PROFILE_TEMPLATE's own defaults) — enough for a two-word name like
 *  "Alex Johnson" to wrap to 2 lines in the browser while fitting on 1 in
 *  the PDF, even though both renderers use the identical "wrap to at most
 *  3 lines" shrink algorithm — a real geometry mismatch, not a timing
 *  race. */
export function profileSidebarBleedWidthPt(template: TemplateDefinition): number {
  const sidebarPct = Math.round((template.sidebarWidthRatio ?? 0.3) * 100);
  const pageContentWidthPt = A4_WIDTH_PT - template.margins.left - template.margins.right;
  const sidebarColumnWidthPt = (pageContentWidthPt * sidebarPct) / 100;
  return PROFILE_SIDEBAR_INSET + sidebarColumnWidthPt + template.spacing.sectionGap / 2;
}

// Measured directly against the real embedded font (LiberationSans-Regular
// via PDFKit's own doc.currentLineHeight(), a standalone Node script — see
// RABBIT_NOTEBOOK.md §45): this font's natural (no extra gap) line height
// is 1.1171875x its font size, consistently across sizes. Used below to
// compute a bullet line-height that matches profile-pdf-renderer.ts's own
// renderBullets exactly, rather than inheriting .cv-profile-doc's generic
// (and, for dense wrapped body text, far too generous) line-height: 1.5.
const LIBERATION_SANS_LINE_HEIGHT_RATIO = 1.1171875;

/** Plain CSS built from PROFILE_TEMPLATE's tokens — same pattern as every
 *  other template. Scoped under `.cv-profile-doc`. The curved cap bottom
 *  uses the standard CSS "wave header" trick (symmetric 50%-width bottom
 *  corner radii meeting in the middle) — see profile-pdf-renderer.ts's own
 *  doc comment for the PDFKit-side equivalent (a quadratic Bézier curve). */
export function buildProfileCss(template: TemplateDefinition): string {
  const { typography: t, colors: c, spacing: s } = template;
  // Fix (RABBIT_NOTEBOOK.md §45 — preview/PDF pagination parity): the
  // ACTUAL cause of Education landing on page 2 in the browser but page 1
  // in the PDF for a bullet-heavy CV. .cvpf-bullets li had no line-height
  // of its own, so it inherited .cv-profile-doc's generic `line-height:
  // 1.5` — while profile-pdf-renderer.ts's renderBullets draws each
  // wrapped bullet line at `doc.currentLineHeight() + (t.spacing.lineGap
  // - 1)`, i.e. LIBERATION_SANS_LINE_HEIGHT_RATIO (~1.117x) plus a SMALL
  // explicit gap — nowhere near 1.5x. Confirmed via direct measurement
  // (RABBIT_NOTEBOOK.md §45): the SAME repro CV's three Employment
  // entries measured 113.68pt/108.67pt/227.27pt in PDFKit but
  // 129.75pt/138.75pt/268.5pt in the browser — a gap that grows with
  // wrapped-line count (worst for the entry with the longest bullets),
  // pushing Education past the page-1 boundary in the browser alone. This
  // computes the EXACT matching pt value for THIS template's own
  // (possibly density-adjusted) bodySize/lineGap, instead of a guessed
  // unitless ratio — an unrelated font-size change elsewhere can never
  // silently drift this back out of sync.
  const bulletLineHeightPt = t.bodySize * LIBERATION_SANS_LINE_HEIGHT_RATIO + (s.lineGap - 1);
  const sidebarPct = Math.round((template.sidebarWidthRatio ?? 0.3) * 100);
  const capBg = template.colors.headerBackground ?? c.accent;
  const capText = template.colors.headerText ?? '#FFFFFF';
  const capMuted = template.colors.headerMutedText ?? '#FFFFFF';
  // Mirrors profile-pdf-renderer.ts's PHOTO_OUTER_RADIUS/PHOTO_TEXT_CLEARANCE/
  // PHOTO_BOTTOM_GAP exactly, so both renderers reserve identical space
  // above and below the photo regardless of how tall the name/title text
  // block ends up being (wrapped or not).
  const PHOTO_DIAMETER = 74;
  const PHOTO_RADIUS = PHOTO_DIAMETER / 2;
  const PHOTO_TEXT_CLEARANCE = 12;
  const PHOTO_BOTTOM_GAP = 18;
  // .cvpf-cap-with-photo's own padding-bottom sizes the blue cap so its
  // bottom edge lands exactly at the photo's vertical CENTER (clearance
  // above the text + the photo's own radius) — the same capFlatHeight math
  // profile-pdf-renderer.ts's drawCap performs.
  const capPaddingBottomWithPhoto = PHOTO_TEXT_CLEARANCE + PHOTO_RADIUS;
  // .cvpf-sidebar-body-with-photo's padding-top then only needs to cover
  // from that same center point down past the photo's other half-radius
  // plus the requested clearance below it.
  const sidebarBodyPaddingTopWithPhoto = PHOTO_RADIUS + PHOTO_BOTTOM_GAP;
  // Aligns the browser preview's outer page margins with the PDF's real
  // template.margins (40/44/40/40pt by default). Scoped to Profile only —
  // via this template's own root class. Previously this subtracted a fixed
  // 24pt for CvBuilderWorkspace.tsx's shared preview card padding, back
  // when Profile rendered inside that same generic wrapper every other
  // template uses; ProfileA4Preview.tsx (apps/web) now gives Profile its
  // own dedicated, unpadded A4 page box instead (see its own doc comment),
  // so `.cv-profile-doc` owns the ENTIRE margin itself with nothing left to
  // subtract — this is also what makes the preview's page genuinely A4-
  // proportioned rather than a page-sized box sitting inside extra padding.
  const marginTop = template.margins.top;
  const marginRight = template.margins.right;
  const marginBottom = template.margins.bottom;
  const marginLeft = template.margins.left;
  const sidebarBg = template.sidebarBackground ?? '#F4F5F6';
  // Mirrors profile-pdf-renderer.ts's own sidebarBleedRight geometry
  // exactly (lm + sidebarW + gap/2) — see that module's own doc comment —
  // so the page-1 cap/sidebar backgrounds bleed to the true page edges by
  // the same amount PDFKit's rect/cap fills do (RABBIT_NOTEBOOK.md §25).
  // Uses the SAME rounded `sidebarPct` already used for `.cvpf-sidebar`'s
  // own flex-basis above (not the raw ratio) so the bleed width stays
  // pixel-consistent with the sidebar's own CSS-rendered width rather than
  // an independently-rounded approximation of it.
  const pageContentWidthPt = A4_WIDTH_PT - marginLeft - marginRight;
  const sidebarColumnWidthPt = (pageContentWidthPt * sidebarPct) / 100;
  // Fix (RABBIT_NOTEBOOK.md, sidebar left-inset rebalance): mirrors
  // profile-pdf-renderer.ts's own SIDEBAR_INSET exactly — Personal
  // Details/Skills/Languages/Qualities previously started at the page's
  // own `marginLeft` (40pt, the SAME margin the plain white main column
  // uses), which read as an excessive gap given the sidebar's own colored
  // background already bleeds to the true left edge (x=0). This gives the
  // sidebar's own content a smaller, purely cosmetic inset (target ~20-24pt)
  // independent of `marginLeft`, which stays the real page margin for
  // everything else. Applied via `.cvpf-sidebar`'s own `margin-left` below
  // — its WIDTH (`sidebarColumnWidthPt`/`sidebarPct`) is UNCHANGED, so this
  // only moves where that same-width column starts; the sidebar's visual
  // footprint (sidebarBleedWidthPt) shrinks by the same amount the content
  // moved left by, and .cvpf-main (flex: 1 1 auto) automatically absorbs
  // that recovered width — never by shrinking sidebar text.
  const SIDEBAR_INSET = PROFILE_SIDEBAR_INSET;
  const sidebarLeftShift = marginLeft - SIDEBAR_INSET;
  const sidebarBleedWidthPt = profileSidebarBleedWidthPt(template);
  // Fix (RABBIT_NOTEBOOK.md §44 — preview/PDF parity investigation):
  // profile-pdf-renderer.ts's drawCap wraps the name/job-title against
  // its BLED capWidth (sidebarBleedRight, reaching the true page edge)
  // minus CAP_PADDING_X — a genuinely WIDER text box than .cvpf-cap's own
  // (deliberately narrower — see its own history below) rendered CSS box.
  // Confirmed via direct measurement (RABBIT_NOTEBOOK.md §44): PDFKit's
  // LiberationSans-Bold and this canvas's own "Arial" metric are
  // essentially IDENTICAL per character (a real 21pt "Alex Johnson"
  // measured 137.69pt in PDFKit vs 137.69pt-equivalent in the browser) —
  // the divergence is PURELY that .cvpf-cap's own box was narrower than
  // PDFKit's bled width by ~27pt for this template's own defaults, wide
  // enough for a plain two-word name to wrap to 2 lines in the browser
  // while comfortably fitting 1 line in the PDF. `capNameWrapExtraPt`
  // extends the name/job-title text's own effective wrap width to match
  // PDFKit's exactly, via a symmetric negative margin (below) — the same
  // established bleed technique already used for `.cvpf-sidebar::before`/
  // `.cvpf-cap::before` above, so the WIDER text stays comfortably inside
  // the cap's own (even-further-bled) background, never outside it.
  // Deliberately does NOT touch `.cvpf-cap`'s own box/padding/width
  // (unlike an EARLIER attempt at this — see `.cvpf-sidebar::before`'s
  // own doc comment for why that specific approach previously reopened a
  // sidebar-clipping regression) — this only widens the WRAP WIDTH of
  // the two text elements themselves, leaving the cap's actual layout
  // width (and therefore every OTHER measurement anchored to it) exactly
  // as it was.
  const capContentWidthPt = sidebarColumnWidthPt - PROFILE_CAP_PADDING_X * 2;
  const capNameWrapExtraPt = Math.max(0, profileNameWrapWidthPt(template) - capContentWidthPt) / 2;
  return `
.cv-profile-doc {
  position: relative;
  display: flex;
  /* Fix (RABBIT_NOTEBOOK.md §25): a single continuation-page header must
     span the FULL page width, ABOVE both columns — not live inside either
     one (see .cvpf-continuation-header/.cvpf-columns below). An EARLIER
     version of this fix used 'flex-wrap: wrap' with the header at
     'flex: 0 0 100%' to force it onto its own line, keeping .cv-profile-doc
     itself as the row container — simpler, but flexbox's default
     'align-content: normal' (~= stretch) for a MULTI-LINE container
     distributes ANY leftover height (from min-height: 100% below) across
     ALL lines, not just the last one — so on a short continuation page the
     HEADER's own line was stretched tall too, pushing a large blank gap
     between the header text and the columns beneath it (confirmed
     visually). flex-direction: column instead makes .cv-profile-doc stack
     [header?, .cvpf-columns] top-to-bottom as ordinary flex-column items;
     only .cvpf-columns (see below) carries flex: 1 1 auto, so it alone
     absorbs 100% of any leftover height — the header stays exactly its own
     natural size. */
  flex-direction: column;
  align-items: stretch;
  /* Fills the whole A4 page box's height (ProfileA4Preview.tsx sizes that
     box to a real 210x297mm aspect ratio) so short content still shows a
     full, correctly-proportioned page with genuine unused space at the
     bottom, matching how a real 1-page PDF looks — not a box that shrinks
     to fit just the content. Longer content still grows past 100% (min-,
     not a fixed height) rather than ever being clipped. */
  min-height: 100%;
  box-sizing: border-box;
  padding: ${marginTop}pt ${marginRight}pt ${marginBottom}pt ${marginLeft}pt;
  font-family: ${t.fontFamily};
  color: ${c.text};
  font-size: ${t.bodySize}pt;
  line-height: 1.5;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}
.cv-profile-doc * {
  box-sizing: border-box;
}
/* The actual sidebar/main ROW — everything that was directly on
   .cv-profile-doc before it became a column stack (RABBIT_NOTEBOOK.md
   §25). flex: 1 1 auto claims all of .cv-profile-doc's leftover height
   (whether that's the page's FULL height on page 1, which has no header,
   or whatever remains below a continuation header) — this is what
   actually reproduces the pre-fix "short content still shows a full-page
   tinted sidebar" behavior, now scoped to just this row instead of
   (incorrectly) also stretching the header. min-height: 0 overrides
   flexbox's default 'min-height: auto' on a flex item, which would
   otherwise be able to prevent this row from shrinking below its content's
   natural height inside the column-flex parent. */
.cv-profile-doc .cvpf-columns {
  display: flex;
  align-items: stretch;
  flex: 1 1 auto;
  min-height: 0;
  /* Fix: matches the PDFKit renderer's actual inter-column gap
     (spacing.sectionGap, same token used as 'gap' in
     profile-pdf-renderer.ts) — previously there was no real gap at all,
     only .cvpf-main's own left padding created the illusion of one, so
     the pale sidebar and white main column visually touched with no
     breathing strip between them, unlike the PDF. */
  gap: ${s.sectionGap}pt;
}
.cv-profile-doc a {
  color: inherit;
  text-decoration: underline;
}
.cv-profile-doc .cvpf-sidebar {
  position: relative;
  /* Fix (RABBIT_NOTEBOOK.md, Profile-preview sidebar-content-invisible bug):
     z-index: 0 turns this into its OWN stacking context, so the z-index: -1
     on .cvpf-sidebar::before below (the page-edge background bleed)
     resolves LOCALLY, against this element's own children, instead of
     escaping to whatever ancestor stacking context happens to be nearest.
     Without this, a positioned box (position: absolute, z-index: auto) —
     which is exactly what that bleed pseudo-element is — paints ABOVE every
     ordinary non-positioned sibling regardless of DOM order (CSS painting-
     order steps: non-positioned in-flow content paints BEFORE positioned
     descendants with z-index: auto/0). Since the bleed's opaque fill
     geometrically covers the sidebar's entire content area (top/bottom set
     to bleed past both page margins), every plain, non-positioned piece of
     real sidebar content (Personal Details, Skills, Languages — anything
     that isn't itself separately positioned) was silently painted UNDER it
     and invisible, even though still genuinely present in the DOM. Only
     content that happened to ALSO be positioned escaped this: the photo
     (.cvpf-photo-wrap is position: absolute) and Qualities list items
     (.cvpf-qualities li is position: relative, for their own bullet-dot
     marker) — both paint in the same "positioned" bucket as the bleed and
     so land on top of it by tree order, which is exactly why only those two
     kept rendering visibly while everything else vanished. Confirmed via
     direct elementFromPoint hit-testing against a real local production
     build before this fix (every sidebar text point resolved to the
     .cvpf-sidebar/.cvpf-cap element itself, not the real text node
     underneath) and re-verified after. */
  z-index: 0;
  flex: 0 0 ${sidebarPct}%;
  max-width: ${sidebarPct}%;
  background: ${sidebarBg};
  /* Fix (RABBIT_NOTEBOOK.md, sidebar left-inset rebalance): shifts the
     WHOLE sidebar box (background + cap + sidebar-body, as one flex item)
     left by (marginLeft - SIDEBAR_INSET) — see sidebarLeftShift's own doc
     comment above. .cvpf-main (flex: 1 1 auto) automatically absorbs the
     recovered width; .cvpf-sidebar's own WIDTH (flex-basis, above) is
     untouched, so the usable text width inside is preserved, not shrunk. */
  margin-left: -${sidebarLeftShift}pt;
}
/* Fix (RABBIT_NOTEBOOK.md §25, widened §44): PDFKit's own sidebar rect
   (doc.rect(0, 0, sidebarBleedRight, doc.page.height)) is filled BEFORE
   any margin is applied, so it reaches the page's true top/left/bottom
   edges; .cvpf-sidebar's own background above only fills its OWN
   (margin-inset) box. This ::before extends the SAME color into the
   margin strips a plain .cvpf-sidebar background can't reach without
   disturbing where .cvpf-main starts (a flex item's own margin would
   shift its sibling; an absolutely positioned ::before paints without
   affecting layout at all). top/left/bottom resolve against
   .cvpf-sidebar's PADDING box (CSS spec's containing-block rule for
   position: absolute), so the negative marginTop/marginLeft/marginBottom
   offsets land it exactly at the page's true edges — the same page box
   .cv-profile-doc's own padding is subtracted from. This geometry is
   identical for page 1 and any later continuation page (same page
   margins, same SIDEBAR_INSET, same sidebar width regardless of what
   content happens to be inside it), so the selector below applies to
   EVERY .cvpf-sidebar — not just .cvpf-sidebar-first (§25's original,
   narrower scope). Fix (§44): a continuation page's sidebar used to keep
   only the plain, margin-inset background — visible as an inset
   rectangle with white space above/left/below it compared to page 1's
   own edge-to-edge tint, the reported "continuation sidebar background
   inconsistency" bug. Every page's .cvpf-sidebar already carries
   z-index: 0 (its own stacking context, unconditionally — see above),
   so this ::before's z-index: -1 resolves LOCALLY and paints behind
   real content on every page, matching PDFKit's own equivalent fix
   (profile-pdf-renderer.ts's ensureContinuationPage).
   Fix (RABBIT_NOTEBOOK.md §45 — follow-up): the claim above ("identical
   geometry for page 1 and any continuation page") was WRONG for the top
   offset specifically. A plain -marginTop correctly cancels
   .cv-profile-doc's own top padding ONLY when .cvpf-sidebar is
   .cv-profile-doc's very FIRST flex child (true on page 1, which has no
   header before it) — on a continuation page, ProfileContinuationHeader
   (ProfileA4Preview.tsx) is an EARLIER flex-column sibling ABOVE
   .cvpf-columns, pushing .cvpf-sidebar's own top down by the header's
   real rendered height — so a fixed -marginTop under-reaches the true
   page top by exactly that amount, leaving the reported white strip.
   The --cvpf-cont-header-h custom property (set inline, per page, by
   ProfileA4Preview.tsx from its own REAL measured continuationHeaderH —
   0px on page 1 / any page with no header) makes this exact on every
   page without guessing a constant.
   Separately: this rect is PART OF .cvpf-columns's box in the outer
   .cv-profile-doc stacking order (.cvpf-sidebar's own z-index:0 only
   reorders its OWN children, not its standing relative to ANCESTOR
   siblings) — and .cvpf-columns is a LATER DOM sibling than the
   continuation header, so even before this fix, whenever their boxes
   geometrically overlapped, this bleed painted OVER the header's text,
   not under it — confirmed by direct inspection (a real screenshot
   showed the header fully invisible, not merely the tint gap alone).
   See .cvpf-continuation-header's own z-index fix below for the other
   half of this. */
.cv-profile-doc .cvpf-sidebar::before {
  content: '';
  position: absolute;
  /* z-index: -1, scoped to .cvpf-sidebar's own stacking context (see its
     z-index: 0 above) — paints this purely-decorative bleed BEHIND the
     sidebar's real content instead of in front of it. See the sidebar-
     content-invisible bug fix above for the full explanation. */
  z-index: -1;
  top: calc(-${marginTop}pt - var(--cvpf-cont-header-h, 0px));
  /* Fix (RABBIT_NOTEBOOK.md, sidebar left-inset rebalance): was
     -marginLeft, which assumed .cvpf-sidebar's own padding box started
     exactly at marginLeft from the true page edge. Now that .cvpf-sidebar
     carries its own margin-left: -sidebarLeftShift (above), its padding
     box already starts at SIDEBAR_INSET instead — so this offset must be
     -SIDEBAR_INSET to still land the bleed's own left edge at the true
     x=0 (SIDEBAR_INSET + (-SIDEBAR_INSET) = 0), not past it. */
  left: -${SIDEBAR_INSET}pt;
  bottom: -${marginBottom}pt;
  width: ${sidebarBleedWidthPt}pt;
  background: ${sidebarBg};
}
.cv-profile-doc .cvpf-cap {
  position: relative;
  /* Fix (RABBIT_NOTEBOOK.md, Profile-preview sidebar-content-invisible bug)
     — same reasoning as .cvpf-sidebar's z-index: 0 above: scopes
     .cvpf-cap::before's z-index: -1 to this element's own stacking
     context, so the cap's page-edge bleed paints behind the name/job-title
     text instead of in front of it. Without this, that text (plain,
     non-positioned) was silently painted under the bleed and invisible —
     only the photo (itself position: absolute) escaped it. */
  z-index: 0;
  background: ${capBg};
  /* Fix: was 20pt/14pt/22pt, silently mismatched with the PDFKit renderer's
     CAP_PADDING_TOP/CAP_PADDING_X/CAP_PADDING_BOTTOM (22/16/20 at the time).
     Matching these exactly gives the name text the same available width in
     both renderers, so it wraps the same way (see profile-pdf-renderer.ts's
     own constants).
     Fix (RABBIT_NOTEBOOK.md, sidebar width/padding rebalance): left/right
     16pt -> 12pt, matching PDFKit's own CAP_PADDING_X reduction — the cap
     is already narrower now that sidebarWidthRatio dropped to 0.3 (see
     template-types.ts), so this recovers some of that width back for the
     name/job-title text itself rather than compounding the narrowing. Top/
     bottom (22pt/20pt) are untouched — they govern the photo/curve
     geometry (capFlatHeight, PHOTO_TEXT_CLEARANCE/PHOTO_BOTTOM_GAP), which
     this rebalance deliberately leaves alone. */
  padding: 22pt ${PROFILE_CAP_PADDING_X}pt 20pt;
  text-align: center;
  border-bottom-left-radius: 50% 18pt;
  border-bottom-right-radius: 50% 18pt;
}
/* Fix (RABBIT_NOTEBOOK.md §25): PDFKit draws the cap at capWidth =
   sidebarBleedRight (the same bled width as the sidebar rect, starting at
   the true page x=0). An EARLIER version of this fix widened .cvpf-cap's
   own box (via negative margins) to match — visually correct, but it also
   widens the box useProfileNameFontSize measures for wrapping, which for
   this template's job-title line can legitimately un-wrap from 2 lines to
   1, shortening the cap's real rendered height by a non-trivial amount
   (confirmed: 167px -> 147px for one real fixture). That shortens
   pageContentTop = capH + pdH, silently re-opening the exact class of
   sidebar-clipping bug §23/§24 fixed (confirmed reproduced: "Test
   Language 2" partially clipped on page 1 of the real Pagination Test CV,
   normal width — an item that fit cleanly on page 2 before this change).
   Reverted to a PURELY DECORATIVE, paint-only bleed instead: .cvpf-cap
   itself keeps its EXACT original box/width/padding (so
   useProfileNameFontSize, capH, and therefore pageContentTop/packColumn
   are completely untouched — verified below by re-running §24's own
   clipping check), and this ::before paints a SEPARATE, WIDER curved
   shape (same 50%/18pt radius formula, which scales correctly to any
   width) behind it, reaching the true page top/left edges and the same
   gap/2 right overshoot PDFKit uses. Costs one honest, disclosed gap from
   pixel-perfect PDFKit parity: the name/job-title TEXT stays centered
   within the original (narrower) box, not re-centered within this wider
   painted region — a purely cosmetic difference, not a layout/pagination
   one, and the far safer trade given "preserve the pagination fixes" was
   an explicit constraint on this task. */
.cv-profile-doc .cvpf-cap::before {
  content: '';
  position: absolute;
  /* z-index: -1 — see .cvpf-cap's own z-index: 0 above. */
  z-index: -1;
  top: -${marginTop}pt;
  /* Fix (RABBIT_NOTEBOOK.md, sidebar left-inset rebalance): was
     -marginLeft — same reasoning as .cvpf-sidebar-first::before's own
     left offset above: .cvpf-cap's padding box now starts at SIDEBAR_INSET
     (it's a plain child of the now-shifted .cvpf-sidebar), so this must be
     -SIDEBAR_INSET to still land at the true page edge (x=0). */
  left: -${SIDEBAR_INSET}pt;
  right: -${s.sectionGap / 2}pt;
  bottom: 0;
  background: ${capBg};
  border-bottom-left-radius: 50% 18pt;
  border-bottom-right-radius: 50% 18pt;
}
.cv-profile-doc .cvpf-cap-with-photo {
  padding-bottom: ${capPaddingBottomWithPhoto}pt;
}
.cv-profile-doc .cvpf-cap h1 {
  margin: 0 -${capNameWrapExtraPt}pt;
  font-weight: 700;
  color: ${capText};
  line-height: 1.15;
  word-break: break-word;
}
.cv-profile-doc .cvpf-job-title {
  margin: 5pt -${capNameWrapExtraPt}pt 0;
  font-size: ${t.jobTitleSize}pt;
  font-weight: 400;
  color: ${capMuted};
  letter-spacing: 0.02em;
}
.cv-profile-doc .cvpf-photo-wrap {
  position: absolute;
  left: 50%;
  top: 100%;
  /* Fix: -60% was an arbitrary offset that didn't correspond to any
     specific measurement. -50% centers the photo-wrap on the cap's own
     bottom edge exactly — since cvpf-cap-with-photo's padding-bottom is
     now sized so that edge sits precisely at the photo's intended center,
     this reproduces the same capFlatHeight/PHOTO_OUTER_RADIUS geometry
     profile-pdf-renderer.ts's drawCap uses, instead of an eyeballed value. */
  transform: translate(-50%, -50%);
  width: ${PHOTO_DIAMETER}pt;
  height: ${PHOTO_DIAMETER}pt;
  border-radius: 50%;
  background: #ffffff;
  padding: 4pt;
  box-shadow: 0 1pt 3pt rgba(0,0,0,0.15);
}
.cv-profile-doc .cvpf-photo {
  width: 100%;
  height: 100%;
  border-radius: 50%;
  object-fit: cover;
  /* Fix: default object-position (50% 50%, dead center) crops evenly off
     the top AND bottom of a typical portrait photo, which for most
     headshot framing (face/eyes in the upper-middle third, hair extending
     to near the top edge) cuts off the crown of the head. Biasing the
     visible window toward the top of the source image keeps the crown in
     frame — matches the same vertical bias applied in the PDFKit renderer
     (profile-pdf-renderer.ts's drawCircularPhoto, PHOTO_VERTICAL_BIAS). */
  object-position: 50% 22%;
  display: block;
}
/* Fix (RABBIT_NOTEBOOK.md, sidebar width/padding rebalance): left/right
   16pt -> 12pt (kept symmetric at the time) — the PDF renderer's
   equivalent sidebar-body content (Personal Details/Skills/Languages/
   Qualities) never had this much horizontal inset to begin with (it uses
   the column's near-full width, offset only by the icon+gap where an icon
   is present — see profile-pdf-renderer.ts's renderPersonalDetails/
   renderRatedList/renderQualities), so this also brought the browser
   preview closer to the PDF's own usable text width, on top of the
   sidebarWidthRatio reduction in template-types.ts.
   Fix (RABBIT_NOTEBOOK.md, sidebar left-inset rebalance): left further
   reduced 12pt -> 0pt. .cvpf-sidebar itself now carries its own
   margin-left shift (SIDEBAR_INSET, see .cvpf-sidebar above) that already
   positions the WHOLE sidebar box at the correct ~20-24pt effective inset
   from the true page edge — this element's own left padding, stacked on
   top of that, would have pushed content past the target again. 0 here
   means content starts flush at the (already correctly positioned) box
   edge, matching the PDF's own sidebarX exactly. Right (12pt) is
   deliberately kept — "reasonable padding near the column boundary"
   (RABBIT_NOTEBOOK.md) — so text doesn't crowd the gap before the main
   column. Top/bottom (18pt/20pt) are untouched. ProfileA4Preview.tsx's
   hidden measurement pass has two inline overrides of this same padding
   for measurement accuracy — kept in sync there too (see its own
   comments). */
.cv-profile-doc .cvpf-sidebar-body {
  padding: 18pt 12pt 20pt 0pt;
}
.cv-profile-doc .cvpf-sidebar-body-with-photo {
  padding-top: ${sidebarBodyPaddingTopWithPhoto}pt;
}
.cv-profile-doc .cvpf-icon {
  width: 10pt;
  height: 10pt;
  color: ${c.accent};
  flex-shrink: 0;
}
.cv-profile-doc .cvpf-pd-list {
  margin: 8pt 0 0;
  padding: 0;
  list-style: none;
}
.cv-profile-doc .cvpf-pd-list li {
  display: flex;
  align-items: center;
  gap: 6pt;
  margin-top: 6pt;
  font-size: ${t.bodySize - 0.6}pt;
  color: ${c.text};
  overflow-wrap: anywhere;
}
.cv-profile-doc .cvpf-pd-list li:first-child {
  margin-top: 0;
}
.cv-profile-doc .cvpf-qualities {
  margin: 8pt 0 0;
  padding-left: 13pt;
  list-style: none;
}
.cv-profile-doc .cvpf-qualities li {
  position: relative;
  margin-top: 5pt;
  font-size: ${t.bodySize - 0.5}pt;
  color: ${c.text};
}
.cv-profile-doc .cvpf-qualities li::before {
  content: '';
  position: absolute;
  left: -13pt;
  top: 0.3em;
  width: 5pt;
  height: 5pt;
  background: ${c.accent};
}
.cv-profile-doc .cvpf-rated-list {
  margin: 8pt 0 0;
  padding: 0;
  list-style: none;
}
.cv-profile-doc .cvpf-rated-list li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6pt;
  margin-top: 7pt;
}
.cv-profile-doc .cvpf-rated-list li:first-child {
  margin-top: 0;
}
.cv-profile-doc .cvpf-rated-name {
  font-size: ${t.bodySize - 0.5}pt;
  font-weight: 600;
  color: ${c.text};
  overflow-wrap: anywhere;
}
.cv-profile-doc .cvpf-rated-level {
  font-weight: 400;
  color: ${c.muted};
}
.cv-profile-doc .cvpf-dots {
  display: inline-flex;
  gap: 2.5pt;
  flex-shrink: 0;
}
.cv-profile-doc .cvpf-dot {
  width: 5.5pt;
  height: 5.5pt;
  border-radius: 50%;
  border: 0.75pt solid ${c.accent};
  background: transparent;
}
.cv-profile-doc .cvpf-dot-filled {
  background: ${c.accent};
}
.cv-profile-doc .cvpf-main {
  flex: 1 1 auto;
  min-width: 0;
  /* Fix: was 24pt/22pt — that extra top padding, on top of the cap
     starting at the very top of the flex row, made the main column's
     first heading sit visibly lower than the cap despite both being flex
     siblings with align-items: stretch (both already start level at the
     row's top edge; this padding was the only thing pushing main's
     content down). Zero here matches the PDFKit fix (main column now
     starts at the page's own top margin, independent of the cap/photo
     height) — both renderers now start the right column at the same
     "page top" reference rather than the PDF only pushing it below the
     cap. The shared preview card's own outer padding still provides page-
     level breathing room around the whole document. */
  padding: 0;
}
.cv-profile-doc .cvpf-heading {
  margin-top: ${s.sectionGap}pt;
}
.cv-profile-doc .cvpf-sidebar-body > :first-child .cvpf-heading,
.cv-profile-doc .cvpf-main > .cvpf-heading:first-child,
.cv-profile-doc .cvpf-main > :first-child .cvpf-heading {
  /* Fix: renderMainSection's 'summary' case wraps its SectionHeading in an
     extra <div key="summary">, unlike workExperience/education/
     certifications/references (which render SectionHeading as their own
     first element via a Fragment) — so when Summary is the first main
     section (the default order), '.cvpf-main > .cvpf-heading:first-child'
     alone never matched it, one extra sectionGap of top margin survived,
     and the right column didn't actually start flush at the top. This
     third selector (matching the sidebar-body rule's own "nested one level
     deep" pattern) covers that case too. */
  margin-top: 0;
}
.cv-profile-doc .cvpf-heading h2 {
  margin: 0 0 4pt;
  font-size: ${t.headingSize}pt;
  /* Fix: was 500 (medium) — the PDFKit renderer draws headings with its
     regular 'Body' font (LiberationSans-Regular, weight 400), matching
     'thin-blue-rule's own "light/regular-weight" design intent
     (template-types.ts). */
  font-weight: 400;
  color: ${c.heading};
}
.cv-profile-doc .cvpf-heading::after {
  content: '';
  display: block;
  width: 100%;
  height: 0.75pt;
  background: ${c.rule};
  margin-top: 3pt;
  margin-bottom: 4pt;
}
.cv-profile-doc .cvpf-summary {
  margin: 8pt 0 0;
  font-size: ${t.bodySize}pt;
  color: ${c.text};
}
/* Matches profile-pdf-renderer.ts's drawContinuationHeader exactly:
   candidate name, uppercased (done in JS — see ProfileContinuationHeader),
   bold, metaSize+1, heading color, a short 36pt accent rule beneath, then
   16pt clearance before the page's actual content. Used only by
   ProfileA4Preview.tsx's paginated preview, on any page after the first
   that a sidebar or main column's own overflow lands on — never shown on
   page 1, which keeps the real ProfileCap (name/title/photo) instead.
   Fix (RABBIT_NOTEBOOK.md §25): PDFKit draws exactly ONE of these per
   continuation page, full page width, shared by both columns
   (drawContinuationHeader(doc, candidateName, lm, pageW, t) — see that
   module's own doc comment on pageContentTop). The preview previously
   rendered this INSIDE each column that had continuation content, so a
   page with both a sidebar and main overflow showed it TWICE. Rendered
   ONCE now, as a direct child of .cv-profile-doc ahead of .cvpf-columns
   (see ProfileA4Preview.tsx) — an ordinary flex-column item that takes
   its own natural height and full width (via .cv-profile-doc's own
   align-items: stretch) with nothing beyond its own margin-bottom
   pushing .cvpf-columns down — see .cv-profile-doc's own doc comment for
   why this needs flex-direction: column rather than flex-wrap. */
.cv-profile-doc .cvpf-continuation-header {
  margin-bottom: 16pt;
  /* Fix (RABBIT_NOTEBOOK.md §45): .cvpf-sidebar's bled ::before (below)
     is part of .cvpf-columns's box in .cv-profile-doc's own stacking
     order; .cvpf-columns is a LATER DOM sibling than this header, so
     whenever their boxes overlap (always, before the top-offset fix
     above; still possible at the boundary even after it, e.g. a header
     taller than one line), plain in-flow siblings paint in DOM order —
     the bleed would paint OVER this header's text, not under it. A
     small explicit stacking elevation guarantees this header always
     wins, regardless of exact overlap geometry — confirmed as the
     actual (not merely hypothesised) cause by direct inspection: a real
     screenshot showed the continuation header fully invisible, not
     just a tint gap above it. */
  position: relative;
  z-index: 1;
}
.cv-profile-doc .cvpf-continuation-header span {
  display: block;
  font-weight: 700;
  font-size: ${t.metaSize + 1}pt;
  color: ${c.heading};
  letter-spacing: 0.6pt;
}
.cv-profile-doc .cvpf-continuation-header::after {
  content: '';
  display: block;
  width: 36pt;
  height: 1.2pt;
  background: ${c.accent};
  margin-top: 5pt;
}
.cv-profile-doc .cvpf-entry {
  margin-top: ${s.entryGap}pt;
  break-inside: avoid;
}
.cv-profile-doc .cvpf-entry:first-child {
  margin-top: 8pt;
}
.cv-profile-doc .cvpf-entry-row {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 10pt;
}
.cv-profile-doc .cvpf-entry-title {
  min-width: 0;
  font-weight: 700;
  color: ${c.text};
}
.cv-profile-doc .cvpf-entry-date {
  flex-shrink: 0;
  font-size: ${t.metaSize}pt;
  color: ${c.muted};
  white-space: nowrap;
}
.cv-profile-doc .cvpf-entry-org {
  margin-top: 2pt;
  font-size: ${t.bodySize - 0.3}pt;
  font-weight: 700;
  color: ${c.accent};
}
.cv-profile-doc .cvpf-entry-loc {
  color: ${c.muted};
  font-weight: 400;
}
.cv-profile-doc .cvpf-entry-meta {
  margin-top: 2pt;
  font-size: ${t.metaSize}pt;
  color: ${c.muted};
}
.cv-profile-doc .cvpf-bullets {
  margin: ${s.bulletGap + 3}pt 0 0;
  padding-left: 13pt;
  list-style: none;
}
.cv-profile-doc .cvpf-bullets li {
  position: relative;
  margin-top: ${s.bulletGap}pt;
  font-size: ${t.bodySize}pt;
  /* Fix (RABBIT_NOTEBOOK.md §45): was unset (inheriting .cv-profile-doc's
     generic line-height: 1.5) — see bulletLineHeightPt's own doc comment
     above for why that silently made wrapped bullets taller here than in
     the PDF, enough to shift Education onto a whole extra page. */
  line-height: ${bulletLineHeightPt}pt;
  color: ${c.text};
  overflow-wrap: break-word;
}
.cv-profile-doc .cvpf-bullets li::before {
  content: '•';
  position: absolute;
  left: -13pt;
  color: ${c.muted};
}
.cv-profile-doc .cvpf-cert {
  margin-top: 10pt;
}
.cv-profile-doc .cvpf-cert:first-child {
  margin-top: 8pt;
}
.cv-profile-doc .cvpf-cert-name {
  font-weight: 700;
  color: ${c.text};
  font-size: ${t.bodySize - 0.5}pt;
}
.cv-profile-doc .cvpf-cert-meta {
  margin-top: 1pt;
  color: ${c.muted};
  font-size: ${t.metaSize}pt;
}
/* Fix (RABBIT_NOTEBOOK.md §44 — preview/PDF parity investigation):
   REMOVED a leftover "@media (max-width: 700px) { .cv-profile-doc {
   flex-direction: column } .cvpf-sidebar { max-width: 100%; flex-basis:
   auto } }" rule here. It predated ProfileA4Preview.tsx's FIXED-WIDTH +
   transform: scale() rewrite (see that file's own top-of-file doc
   comment) — from when .cv-profile-doc sized itself to a percentage of
   whatever (possibly narrow) box it was given, so reflowing to a single
   stacked column below 700 CSS px was a reasonable responsive fallback
   for that OLD architecture. CSS media queries evaluate against the
   real browser VIEWPORT width — not any individual element's own
   explicit pixel width — so this rule kept firing even after the
   rewrite, and it fired for BOTH the visible page (whose whole point is
   to stay a fixed 595.28pt/A4-proportioned document at every viewport,
   scaled visually via transform: scale(), never reflowed) AND the
   hidden, explicitly-fixed-width (A4_WIDTH_PT points wide) measurement
   pass ProfileA4Preview.tsx uses to compute real pagination — meaning
   .cvpf-sidebar's actual width (and therefore every wrap/height
   measurement inside it: the name in the cap, every skill/language/
   quality row) silently changed whenever the ACTUAL BROWSER WINDOW
   happened to be ≤700px, something neither renderer's architecture was
   ever supposed to depend on. Confirmed via direct measurement
   (RABBIT_NOTEBOOK.md §44): the exact same CV/content produced a
   measured cap height of 206px at a 1600px-wide window vs 153px at a
   700px-wide window, and a Qualities list that paginated correctly at
   one width but silently overflowed page 1 (clipped by the page box's
   own overflow: hidden) at another — reproducing both the reported
   Qualities-clipping bug and part of the preview/PDF name-wrapping
   divergence. No live consumer of this stylesheet currently wants
   viewport-responsive reflow (ProfileCvDocument, the only other
   consumer, isn't rendered anywhere in this codebase today) — removing
   this rule makes "browser viewport size scales the A4 preview rather
   than changing the document's layout" (this task's own explicit
   requirement) actually true, matching the fixed-width architecture's
   already-stated intent. */
`;
}

/** Static, standard-density CSS at PROFILE_TEMPLATE's own baseline tokens —
 *  kept for any consumer that wants Profile's stylesheet without per-CV
 *  automatic spacing. `ProfileCvDocument` itself no longer uses this: it
 *  builds and injects its own density-adjusted CSS per render (see its own
 *  `useMemo` above), since the whole point of automatic spacing is that the
 *  stylesheet depends on the CV's content, not just the template. */
export const PROFILE_CSS = buildProfileCss(PROFILE_TEMPLATE);
