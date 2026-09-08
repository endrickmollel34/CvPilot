import { useLayoutEffect, useRef, useState } from 'react';
import type {
  CvContent,
  CvSection,
  CvWorkEntry,
  CvEducationEntry,
  CvCertificationEntry,
} from '../types/cv.types';
import { MINIMAL_TEMPLATE, type TemplateDefinition } from './template-types';
import {
  formatDateRange,
  normalizeExternalUrl,
  normalizeParagraph,
  shortenUrlLabel,
} from './format';
import { DEFAULT_SECTION_ORDER } from './classic-document';

// V1.1 adaptive name-size bounds — mirrors pdf-generation.service.ts's
// minimalNameFontSize (same base/floor/step) so the browser preview picks
// the same header proportions as the downloaded PDF for a very long
// candidate name. See that method's doc comment for the full rationale;
// normal names are completely unaffected.
const MINIMAL_NAME_BASE_SIZE = MINIMAL_TEMPLATE.typography.nameSize;
const MINIMAL_NAME_FLOOR_SIZE = 24;
const MINIMAL_NAME_STEP = 2;

/**
 * Picks the largest size in [MINIMAL_NAME_FLOOR_SIZE, MINIMAL_NAME_BASE_SIZE]
 * (in MINIMAL_NAME_STEP increments) at which `name` wraps to 2 lines or
 * fewer within the h1's own rendered width — approximated with a hidden
 * canvas 2D context measuring 'Arial' (metric-compatible with the
 * embedded Liberation Sans, same substitution logic already used
 * elsewhere in this codebase), since neither PDFKit nor the browser
 * expose a shared text-measurement API. Runs in `useLayoutEffect` (fires
 * before paint, not after) so there is no visible flash of an oversized
 * name before the correction applies. SSR-safe: falls back to the base
 * size (matching the CSS default) until the effect can run client-side.
 */
function useMinimalNameFontSize(
  name: string,
): [number, React.RefObject<HTMLHeadingElement | null>] {
  const ref = useRef<HTMLHeadingElement>(null);
  const [size, setSize] = useState(MINIMAL_NAME_BASE_SIZE);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof document === 'undefined') return;
    const widthPx = el.clientWidth;
    if (!widthPx) return;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const words = name.split(/\s+/).filter(Boolean);
    let chosen = MINIMAL_NAME_BASE_SIZE;
    for (
      let candidate = MINIMAL_NAME_BASE_SIZE;
      candidate >= MINIMAL_NAME_FLOOR_SIZE;
      candidate -= MINIMAL_NAME_STEP
    ) {
      // 1pt = 1/72in; canvas measures in CSS px (96/in) — convert so the
      // simulated wrap matches the real @page-pt-based layout.
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

/**
 * CV Template Foundation, Phase 3 — Minimal, browser side. "Quiet luxury":
 * a genuinely distinct third design, not a variation of Classic or
 * Modern — single-column, editorial, near-monochrome. Gets its
 * personality entirely from typography, whitespace, and proportion, never
 * from color or structure (no sidebar, no chips, no bars/dots/icons). See
 * MINIMAL_TEMPLATE's doc comment (template-types.ts) for the palette/
 * spacing rationale, and the module report for what was deliberately
 * avoided and why.
 */

function SectionHeading({ title }: { title: string }) {
  return (
    <div className="cvmin-heading">
      <h2>{title}</h2>
    </div>
  );
}

// Same shortened-label-but-full-hyperlink approach as Modern's ContactItem
// (see modern-document.tsx) — a long LinkedIn/website value must never
// dominate the header, but the real destination is always preserved.
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
        <div key={e.id} className="cvmin-entry">
          <div className="cvmin-entry-row">
            <span className="cvmin-entry-title">{e.title}</span>
            <span className="cvmin-entry-date">
              {formatDateRange(e.startDate, e.endDate, e.current)}
            </span>
          </div>
          <div className="cvmin-entry-org">
            {e.company}
            {e.location ? <span className="cvmin-entry-loc"> · {e.location}</span> : null}
          </div>
          {e.bullets.length > 0 && (
            <ul className="cvmin-bullets">
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
        <div key={e.id} className="cvmin-entry">
          <div className="cvmin-entry-row">
            <span className="cvmin-entry-title">
              {e.degree}
              {e.field ? ` — ${e.field}` : ''}
            </span>
            <span className="cvmin-entry-date">{formatDateRange(e.startDate, e.endDate)}</span>
          </div>
          <div className="cvmin-entry-org">
            {e.institution}
            {e.location ? <span className="cvmin-entry-loc"> · {e.location}</span> : null}
          </div>
          {/* Neutral "Grade:" label — the schema's `grade` field has no
              declared scale (GPA, percentage, classification, ...), so this
              never guesses one. Same convention as Classic/Modern. */}
          {e.grade && <div className="cvmin-entry-meta">Grade: {e.grade}</div>}
        </div>
      ))}
    </>
  );
}

function CertificationsSection({ certs }: { certs: CvCertificationEntry[] }) {
  if (!certs.length) return null;
  return (
    <>
      <SectionHeading title="Certifications" />
      {certs.map((c) => (
        <div className="cvmin-cert" key={c.id}>
          <div className="cvmin-cert-name">{c.name}</div>
          {(c.issuer || c.date) && (
            <div className="cvmin-cert-meta">{[c.issuer, c.date].filter(Boolean).join(' · ')}</div>
          )}
        </div>
      ))}
    </>
  );
}

function renderSection(content: CvContent, section: CvSection) {
  switch (section) {
    case 'summary':
      if (!content.summary) return null;
      return (
        <div key="summary">
          <SectionHeading title="Summary" />
          <p className="cvmin-summary">{normalizeParagraph(content.summary)}</p>
        </div>
      );
    case 'workExperience':
      return <WorkEntries key="work" entries={content.workExperience} />;
    case 'education':
      return <EducationEntries key="edu" entries={content.education} />;
    case 'skills':
      // Plain typographic list, not Modern's bordered chips — every skill
      // is preserved completely (it's ordinary wrapped text, never
      // truncated) and reads as elegant rather than tag-like.
      if (!content.skills.length) return null;
      return (
        <div key="skills">
          <SectionHeading title="Skills" />
          <p className="cvmin-inline-list">
            {content.skills
              .map((s) => (s.level ? `${s.name} · ${s.level}` : s.name))
              .join('   ·   ')}
          </p>
        </div>
      );
    case 'languages':
      if (!content.languages.length) return null;
      return (
        <div key="languages">
          <SectionHeading title="Languages" />
          <p className="cvmin-inline-list">
            {content.languages
              .map((l) => (l.level ? `${l.name} (${l.level})` : l.name))
              .join('   ·   ')}
          </p>
        </div>
      );
    case 'certifications':
      return <CertificationsSection key="certs" certs={content.certifications} />;
    default:
      return null;
  }
}

export function MinimalCvDocument({ content }: { content: CvContent }) {
  const { personalDetails: pd, sectionOrder } = content;
  const order = sectionOrder.length > 0 ? sectionOrder : DEFAULT_SECTION_ORDER;
  const [nameFontSize, nameRef] = useMinimalNameFontSize(pd.fullName || 'Your Name');

  // Contact info arranged as two deliberate groups — factual personal
  // details, then professional links — rather than one long dumped line
  // (see the module report's contact-row brief). This also naturally
  // isolates long URLs onto their own line instead of crowding email/
  // phone/location.
  const personalLine = [pd.email, pd.phone, pd.location].filter(Boolean);
  const linkNodes = [
    pd.linkedIn ? <ContactItem key="linkedin" href={pd.linkedIn} /> : null,
    pd.website ? <ContactItem key="website" href={pd.website} /> : null,
  ].filter(Boolean);

  return (
    <div className="cv-minimal-doc">
      <div className="cvmin-header">
        <h1 ref={nameRef} style={{ fontSize: `${nameFontSize}pt` }}>
          {pd.fullName || 'Your Name'}
        </h1>
        {pd.jobTitle && <p className="cvmin-job-title">{pd.jobTitle}</p>}
        {(personalLine.length > 0 || linkNodes.length > 0) && (
          <div className="cvmin-contact">
            {personalLine.length > 0 && (
              <p className="cvmin-contact-line">{personalLine.join('   ·   ')}</p>
            )}
            {linkNodes.length > 0 && (
              <p className="cvmin-contact-line">
                {linkNodes.map((node, i) => (
                  <span key={i}>
                    {node}
                    {i < linkNodes.length - 1 ? '   ·   ' : ''}
                  </span>
                ))}
              </p>
            )}
          </div>
        )}
        <div className="cvmin-header-rule" />
      </div>
      {order.map((section) => renderSection(content, section))}
    </div>
  );
}

/** Plain CSS built from MINIMAL_TEMPLATE's tokens — same pattern as
 *  classic-document.tsx / modern-document.tsx. Scoped under
 *  `.cv-minimal-doc`. */
export function buildMinimalCss(template: TemplateDefinition): string {
  const { typography: t, colors: c, spacing: s } = template;
  return `
.cv-minimal-doc {
  font-family: ${t.fontFamily};
  color: ${c.text};
  font-size: ${t.bodySize}pt;
  line-height: 1.55;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}
.cv-minimal-doc * {
  box-sizing: border-box;
}
.cv-minimal-doc a {
  color: inherit;
  text-decoration: underline;
}
.cv-minimal-doc .cvmin-header h1 {
  margin: 0;
  font-size: ${t.nameSize}pt;
  font-weight: 700;
  color: ${c.text};
  letter-spacing: -0.01em;
  line-height: 1.05;
}
.cv-minimal-doc .cvmin-job-title {
  margin: 6pt 0 0;
  font-size: ${t.jobTitleSize}pt;
  font-weight: 400;
  color: ${c.muted};
  letter-spacing: 0.02em;
}
.cv-minimal-doc .cvmin-contact {
  margin-top: 14pt;
}
.cv-minimal-doc .cvmin-contact-line {
  margin: 3pt 0 0;
  font-size: ${t.metaSize}pt;
  color: ${c.muted};
  word-break: break-word;
}
.cv-minimal-doc .cvmin-contact-line:first-child {
  margin-top: 0;
}
.cv-minimal-doc .cvmin-header-rule {
  height: 0.75pt;
  width: 130pt;
  background: ${c.accent};
  margin-top: 16pt;
}
.cv-minimal-doc .cvmin-heading {
  margin-top: ${s.sectionGap}pt;
  break-after: avoid;
  break-inside: avoid;
}
.cv-minimal-doc .cvmin-heading h2 {
  margin: 0;
  font-size: ${t.headingSize}pt;
  font-weight: 700;
  letter-spacing: 0.02em;
  color: ${c.heading};
}
.cv-minimal-doc .cvmin-summary {
  margin: 8pt 0 0;
  font-size: ${t.bodySize}pt;
  color: ${c.text};
}
.cv-minimal-doc .cvmin-inline-list {
  margin: 8pt 0 0;
  font-size: ${t.bodySize}pt;
  color: ${c.text};
  overflow-wrap: break-word;
}
.cv-minimal-doc .cvmin-entry {
  margin-top: ${s.entryGap}pt;
  break-inside: avoid;
}
.cv-minimal-doc .cvmin-entry:first-child {
  margin-top: 8pt;
}
.cv-minimal-doc .cvmin-entry-row {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 10pt;
}
.cv-minimal-doc .cvmin-entry-title {
  min-width: 0;
  font-weight: 700;
  color: ${c.text};
}
.cv-minimal-doc .cvmin-entry-date {
  flex-shrink: 0;
  font-size: ${t.metaSize}pt;
  color: ${c.muted};
  white-space: nowrap;
}
.cv-minimal-doc .cvmin-entry-org {
  margin-top: 2pt;
  font-size: ${t.bodySize - 0.5}pt;
  font-weight: 600;
  color: ${c.accent};
}
.cv-minimal-doc .cvmin-entry-loc {
  color: ${c.muted};
  font-weight: 400;
}
.cv-minimal-doc .cvmin-entry-meta {
  margin-top: 2pt;
  font-size: ${t.metaSize}pt;
  color: ${c.muted};
}
.cv-minimal-doc .cvmin-bullets {
  margin: ${s.bulletGap + 3}pt 0 0;
  padding-left: 13pt;
  list-style: none;
}
.cv-minimal-doc .cvmin-bullets li {
  position: relative;
  margin-top: ${s.bulletGap}pt;
  font-size: ${t.bodySize}pt;
  color: ${c.text};
  overflow-wrap: break-word;
}
.cv-minimal-doc .cvmin-bullets li::before {
  content: '–';
  position: absolute;
  left: -13pt;
  color: ${c.muted};
}
.cv-minimal-doc .cvmin-cert {
  margin-top: 10pt;
}
.cv-minimal-doc .cvmin-cert:first-child {
  margin-top: 8pt;
}
.cv-minimal-doc .cvmin-cert-name {
  font-weight: 700;
  color: ${c.text};
  font-size: ${t.bodySize - 0.5}pt;
}
.cv-minimal-doc .cvmin-cert-meta {
  margin-top: 1pt;
  color: ${c.muted};
  font-size: ${t.metaSize}pt;
}
`;
}

/** The rendered Minimal stylesheet, ready to inject as a <style> tag. */
export const MINIMAL_CSS = buildMinimalCss(MINIMAL_TEMPLATE);
