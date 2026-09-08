import { useLayoutEffect, useRef, useState } from 'react';
import type {
  CvContent,
  CvSection,
  CvWorkEntry,
  CvEducationEntry,
  CvCertificationEntry,
} from '../types/cv.types';
import { COMPACT_TEMPLATE, type TemplateDefinition } from './template-types';
import {
  formatDateRange,
  normalizeExternalUrl,
  normalizeParagraph,
  shortenUrlLabel,
} from './format';
import { DEFAULT_SECTION_ORDER } from './classic-document';

/**
 * CV Template Foundation, Phase 5 — Compact, browser side. For candidates
 * with substantial content who want efficient page-space use without
 * sacrificing readability. See COMPACT_TEMPLATE's doc comment (template-
 * types.ts) for the full design rationale — in particular why this is
 * NOT "Minimal with smaller fonts": density comes from the tightest
 * spacing tokens of any template plus ONE structural idea — Skills/
 * Languages/Certifications render as a single horizontal, multi-column
 * footer band (see `renderSecondaryBand`) instead of three stacked
 * sections: each present section keeps its own heading, but the band's
 * combined vertical footprint is the height of its tallest column, not
 * the sum of three stacked sections' heights, and the gap before it is
 * paid once instead of three times.
 */

// Adaptive name-size bounds — same technique proven on Minimal/
// Professional (see their own doc comments), re-derived here with
// Compact's own (smaller) base/floor rather than importing either
// private implementation.
const COMPACT_NAME_BASE_SIZE = COMPACT_TEMPLATE.typography.nameSize;
const COMPACT_NAME_FLOOR_SIZE = 15;
const COMPACT_NAME_STEP = 1;

function useCompactNameFontSize(
  name: string,
): [number, React.RefObject<HTMLHeadingElement | null>] {
  const ref = useRef<HTMLHeadingElement>(null);
  const [size, setSize] = useState(COMPACT_NAME_BASE_SIZE);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof document === 'undefined') return;
    const widthPx = el.clientWidth;
    if (!widthPx) return;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const words = name.split(/\s+/).filter(Boolean);
    let chosen = COMPACT_NAME_BASE_SIZE;
    for (
      let candidate = COMPACT_NAME_BASE_SIZE;
      candidate >= COMPACT_NAME_FLOOR_SIZE;
      candidate -= COMPACT_NAME_STEP
    ) {
      ctx.font = `700 ${(candidate * 96) / 72}px Arial`;
      let lines = 1;
      let lineWidth = 0;
      for (const word of words) {
        const wordWidth = ctx.measureText(`${word} `).width;
        if (lineWidth > 0 && lineWidth + wordWidth > widthPx) {
          lines += 1;
          lineWidth = wordWidth;
        } else {
          lineWidth += wordWidth;
        }
      }
      chosen = candidate;
      if (lines <= 2) break;
    }
    setSize(chosen);
  }, [name]);

  return [size, ref];
}

function SectionHeading({ title }: { title: string }) {
  return (
    <div className="cvc-heading">
      <span className="cvc-marker" aria-hidden="true" />
      <h2>{title}</h2>
      <span className="cvc-heading-rule" aria-hidden="true" />
    </div>
  );
}

function ContactItem({ href }: { href: string }) {
  const url = normalizeExternalUrl(href);
  const label = shortenUrlLabel(href);
  if (!url) return <span>{label}</span>;
  return (
    <a href={url} target="_blank" rel="noreferrer">
      {label}
    </a>
  );
}

function WorkEntries({ entries }: { entries: CvWorkEntry[] }) {
  if (!entries.length) return null;
  return (
    <>
      <SectionHeading title="Experience" />
      {entries.map((e) => (
        <div key={e.id} className="cvc-entry">
          <div className="cvc-entry-row">
            <span className="cvc-entry-title">{e.title}</span>
            <span className="cvc-entry-date">
              {formatDateRange(e.startDate, e.endDate, e.current)}
            </span>
          </div>
          <div className="cvc-entry-org">
            {e.company}
            {e.location ? <span className="cvc-entry-loc"> · {e.location}</span> : null}
          </div>
          {e.bullets.length > 0 && (
            <ul className="cvc-bullets">
              {e.bullets.map((b, i) => (
                <li key={i}>{b}</li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </>
  );
}

function EducationEntries({ entries }: { entries: CvEducationEntry[] }) {
  if (!entries.length) return null;
  return (
    <>
      <SectionHeading title="Education" />
      {entries.map((e) => (
        <div key={e.id} className="cvc-entry">
          <div className="cvc-entry-row">
            <span className="cvc-entry-title">
              {e.degree}
              {e.field ? ` — ${e.field}` : ''}
            </span>
            <span className="cvc-entry-date">{formatDateRange(e.startDate, e.endDate)}</span>
          </div>
          <div className="cvc-entry-org">
            {e.institution}
            {e.location ? <span className="cvc-entry-loc"> · {e.location}</span> : null}
          </div>
          {/* Neutral "Grade:" label — the schema's `grade` field has no
              declared scale, so this never guesses one. Same convention
              as every other template. */}
          {e.grade && <div className="cvc-entry-meta">Grade: {e.grade}</div>}
        </div>
      ))}
    </>
  );
}

function renderMainSection(content: CvContent, section: CvSection) {
  switch (section) {
    case 'summary':
      if (!content.summary) return null;
      return (
        <div key="summary">
          <SectionHeading title="Summary" />
          <p className="cvc-summary">{normalizeParagraph(content.summary)}</p>
        </div>
      );
    case 'workExperience':
      return <WorkEntries key="work" entries={content.workExperience} />;
    case 'education':
      return <EducationEntries key="edu" entries={content.education} />;
    default:
      return null;
  }
}

/**
 * The template's one structural signature: Skills, Languages, and
 * Certifications share a SINGLE horizontal row of columns rather than
 * three separately-headed stacked sections — each keeps its own heading,
 * but the row's combined vertical footprint is the height of its tallest
 * column (not the sum of three stacked sections), and the gap before it
 * is paid once, not three times. Only present sections get a
 * column, and present columns share the row's width equally (CSS
 * `flex: 1 1 0` per column) — never a fixed one-third slot sitting empty
 * when a CV has no certifications, for example.
 */
function renderSecondaryBand(content: CvContent) {
  const hasSkills = content.skills.length > 0;
  const hasLanguages = content.languages.length > 0;
  const hasCerts = content.certifications.length > 0;
  if (!hasSkills && !hasLanguages && !hasCerts) return null;

  return (
    <div className="cvc-band">
      {hasSkills && (
        <div className="cvc-band-col">
          <SectionHeading title="Skills" />
          <p className="cvc-band-inline">
            {content.skills
              .map((s) => (s.level ? `${s.name} · ${s.level}` : s.name))
              .join('   ·   ')}
          </p>
        </div>
      )}
      {hasLanguages && (
        <div className="cvc-band-col">
          <SectionHeading title="Languages" />
          <p className="cvc-band-inline">
            {content.languages
              .map((l) => (l.level ? `${l.name} (${l.level})` : l.name))
              .join('   ·   ')}
          </p>
        </div>
      )}
      {hasCerts && (
        <div className="cvc-band-col">
          <SectionHeading title="Certifications" />
          {content.certifications.map((c: CvCertificationEntry) => (
            <div className="cvc-cert" key={c.id}>
              <div className="cvc-cert-name">{c.name}</div>
              {(c.issuer || c.date) && (
                <div className="cvc-cert-meta">
                  {[c.issuer, c.date].filter(Boolean).join(' · ')}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function CompactCvDocument({ content }: { content: CvContent }) {
  const { personalDetails: pd, sectionOrder } = content;
  const order = sectionOrder.length > 0 ? sectionOrder : DEFAULT_SECTION_ORDER;
  const secondarySet = new Set(COMPACT_TEMPLATE.sidebarSections ?? []);
  const mainSections = order.filter((s) => !secondarySet.has(s));
  const [nameFontSize, nameRef] = useCompactNameFontSize(pd.fullName || 'Your Name');

  // ONE efficient wrapped line, not Minimal/Professional's deliberate
  // two-line grouping — "arranged efficiently... wrapping safely" per
  // the module report's header brief. Long URLs still use the shortened
  // display label with the full untruncated hyperlink destination.
  const contactParts = [
    pd.email ? <span key="email">{pd.email}</span> : null,
    pd.phone ? <span key="phone">{pd.phone}</span> : null,
    pd.location ? <span key="location">{pd.location}</span> : null,
    pd.linkedIn ? <ContactItem key="linkedin" href={pd.linkedIn} /> : null,
    pd.website ? <ContactItem key="website" href={pd.website} /> : null,
  ].filter(Boolean);

  return (
    <div className="cv-compact-doc">
      <div className="cvc-header">
        <h1 ref={nameRef} style={{ fontSize: `${nameFontSize}pt` }}>
          {pd.fullName || 'Your Name'}
        </h1>
        {pd.jobTitle && <p className="cvc-job-title">{pd.jobTitle}</p>}
        {contactParts.length > 0 && (
          <p className="cvc-contact">
            {contactParts.map((node, i) => (
              <span key={i}>
                {node}
                {i < contactParts.length - 1 ? '   ·   ' : ''}
              </span>
            ))}
          </p>
        )}
        <div className="cvc-header-rule" />
      </div>
      {mainSections.map((section) => renderMainSection(content, section))}
      {renderSecondaryBand(content)}
    </div>
  );
}

/** Plain CSS built from COMPACT_TEMPLATE's tokens — same pattern as
 *  every other template. Scoped under `.cv-compact-doc`. */
export function buildCompactCss(template: TemplateDefinition): string {
  const { typography: t, colors: c, spacing: s } = template;
  return `
.cv-compact-doc {
  font-family: ${t.fontFamily};
  color: ${c.text};
  font-size: ${t.bodySize}pt;
  line-height: 1.35;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}
.cv-compact-doc * {
  box-sizing: border-box;
}
.cv-compact-doc a {
  color: inherit;
  text-decoration: underline;
}
.cv-compact-doc .cvc-header h1 {
  margin: 0;
  font-weight: 700;
  color: ${c.text};
  letter-spacing: -0.005em;
  line-height: 1.1;
}
.cv-compact-doc .cvc-job-title {
  margin: 3pt 0 0;
  font-size: ${t.jobTitleSize}pt;
  font-weight: 400;
  color: ${c.muted};
}
.cv-compact-doc .cvc-contact {
  margin: 5pt 0 0;
  font-size: ${t.metaSize}pt;
  color: ${c.muted};
  word-break: break-word;
}
.cv-compact-doc .cvc-header-rule {
  height: 1.5pt;
  width: 30pt;
  background: ${c.accent};
  margin-top: 8pt;
}
.cv-compact-doc .cvc-heading {
  display: flex;
  align-items: center;
  gap: 6pt;
  margin-top: ${s.sectionGap}pt;
}
.cv-compact-doc .cvc-heading:first-child {
  margin-top: 0;
}
.cv-compact-doc .cvc-heading .cvc-marker {
  flex-shrink: 0;
  width: 5pt;
  height: 5pt;
  background: ${c.accent};
}
.cv-compact-doc .cvc-heading h2 {
  margin: 0;
  font-size: ${t.headingSize}pt;
  font-weight: 700;
  color: ${c.heading};
  white-space: nowrap;
}
.cv-compact-doc .cvc-heading .cvc-heading-rule {
  flex: 1 1 auto;
  height: 0.75pt;
  background: ${c.rule};
}
.cv-compact-doc .cvc-summary {
  margin: 5pt 0 0;
  font-size: ${t.bodySize}pt;
  color: ${c.text};
}
.cv-compact-doc .cvc-entry {
  margin-top: ${s.entryGap}pt;
  break-inside: avoid;
}
.cv-compact-doc .cvc-entry:first-of-type {
  margin-top: 5pt;
}
.cv-compact-doc .cvc-entry-row {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 8pt;
}
.cv-compact-doc .cvc-entry-title {
  min-width: 0;
  font-weight: 700;
  color: ${c.text};
}
.cv-compact-doc .cvc-entry-date {
  flex-shrink: 0;
  font-size: ${t.metaSize}pt;
  color: ${c.muted};
  white-space: nowrap;
}
.cv-compact-doc .cvc-entry-org {
  margin-top: 1pt;
  font-size: ${t.bodySize - 0.2}pt;
  font-weight: 700;
  color: ${c.text};
}
.cv-compact-doc .cvc-entry-loc {
  color: ${c.muted};
  font-weight: 400;
}
.cv-compact-doc .cvc-entry-meta {
  margin-top: 1pt;
  font-size: ${t.metaSize}pt;
  color: ${c.muted};
}
.cv-compact-doc .cvc-bullets {
  margin: ${s.bulletGap + 2}pt 0 0;
  padding-left: 11pt;
  list-style: none;
}
.cv-compact-doc .cvc-bullets li {
  position: relative;
  margin-top: ${s.bulletGap}pt;
  font-size: ${t.bodySize}pt;
  color: ${c.text};
  overflow-wrap: break-word;
}
.cv-compact-doc .cvc-bullets li::before {
  content: '-';
  position: absolute;
  left: 0;
  color: ${c.muted};
}
.cv-compact-doc .cvc-band {
  display: flex;
  gap: ${s.sectionGap}pt;
  margin-top: ${s.sectionGap}pt;
}
.cv-compact-doc .cvc-band-col {
  flex: 1 1 0;
  min-width: 0;
}
.cv-compact-doc .cvc-band-inline {
  margin: 5pt 0 0;
  font-size: ${t.bodySize - 0.3}pt;
  color: ${c.text};
  overflow-wrap: break-word;
}
.cv-compact-doc .cvc-cert {
  margin-top: 6pt;
}
.cv-compact-doc .cvc-cert:first-child {
  margin-top: 5pt;
}
.cv-compact-doc .cvc-cert-name {
  font-weight: 700;
  color: ${c.text};
  font-size: ${t.bodySize - 0.3}pt;
}
.cv-compact-doc .cvc-cert-meta {
  margin-top: 1pt;
  color: ${c.muted};
  font-size: ${t.metaSize}pt;
}
`;
}

/** The rendered Compact stylesheet, ready to inject as a <style> tag. */
export const COMPACT_CSS = buildCompactCss(COMPACT_TEMPLATE);
