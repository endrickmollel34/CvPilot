import { useLayoutEffect, useRef, useState } from 'react';
import type {
  CvContent,
  CvSection,
  CvWorkEntry,
  CvEducationEntry,
  CvCertificationEntry,
} from '../types/cv.types';
import { PROFESSIONAL_TEMPLATE, type TemplateDefinition } from './template-types';
import {
  formatDateRange,
  normalizeExternalUrl,
  normalizeParagraph,
  shortenUrlLabel,
} from './format';
import { DEFAULT_SECTION_ORDER } from './classic-document';

/**
 * CV Template Foundation, Phase 4 — Professional, browser side. Premium
 * corporate: a full-bleed navy header band (the template's one confident
 * use of color), then a white body in an asymmetric ~65/35 split. See
 * PROFESSIONAL_TEMPLATE's doc comment (template-types.ts) for the full
 * design rationale — in particular why the secondary column stays plain
 * white/near-white (a thin rule, not a tint, differentiates it) rather
 * than reusing Modern's tinted-sidebar mechanic.
 */

// V1 adaptive name-size bounds — same technique proven on Minimal (see
// minimal-document.tsx's useMinimalNameFontSize), re-derived here rather
// than imported: Professional has its own base size, its own floor
// (chosen to stay confidently legible in white-on-navy), and must not
// create a dependency on Minimal's private implementation.
const PROFESSIONAL_NAME_BASE_SIZE = PROFESSIONAL_TEMPLATE.typography.nameSize;
const PROFESSIONAL_NAME_FLOOR_SIZE = 20;
const PROFESSIONAL_NAME_STEP = 2;

/**
 * Picks the largest size in [PROFESSIONAL_NAME_FLOOR_SIZE,
 * PROFESSIONAL_NAME_BASE_SIZE] (in PROFESSIONAL_NAME_STEP increments) at
 * which `name` wraps to 2 lines or fewer within the h1's own rendered
 * width — approximated with a hidden canvas 2D context measuring 'Arial'
 * (metric-compatible with the embedded Liberation Sans). Mirrors the PDF
 * renderer's own measurement-based approach so preview and PDF pick the
 * same header proportions. Runs in `useLayoutEffect` (before paint, so no
 * visible flash) and is SSR-safe: falls back to the base size (matching
 * the CSS default) until the effect can run client-side.
 */
function useProfessionalNameFontSize(
  name: string,
): [number, React.RefObject<HTMLHeadingElement | null>] {
  const ref = useRef<HTMLHeadingElement>(null);
  const [size, setSize] = useState(PROFESSIONAL_NAME_BASE_SIZE);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof document === 'undefined') return;
    const widthPx = el.clientWidth;
    if (!widthPx) return;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const words = name.split(/\s+/).filter(Boolean);
    let chosen = PROFESSIONAL_NAME_BASE_SIZE;
    for (
      let candidate = PROFESSIONAL_NAME_BASE_SIZE;
      candidate >= PROFESSIONAL_NAME_FLOOR_SIZE;
      candidate -= PROFESSIONAL_NAME_STEP
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
    <div className="cvp-heading">
      <h2>{title}</h2>
    </div>
  );
}

// Shortened-label-but-full-hyperlink contact link — same approach as
// Modern/Minimal (see their ContactItem) — a long LinkedIn/website value
// must never dominate the header, but the real destination is preserved.
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
        <div key={e.id} className="cvp-entry">
          <div className="cvp-entry-row">
            <span className="cvp-entry-title">{e.title}</span>
            <span className="cvp-entry-date">
              {formatDateRange(e.startDate, e.endDate, e.current)}
            </span>
          </div>
          <div className="cvp-entry-org">
            {e.company}
            {e.location ? <span className="cvp-entry-loc"> · {e.location}</span> : null}
          </div>
          {e.bullets.length > 0 && (
            <ul className="cvp-bullets">
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
        <div key={e.id} className="cvp-entry">
          <div className="cvp-entry-row">
            <span className="cvp-entry-title">
              {e.degree}
              {e.field ? ` — ${e.field}` : ''}
            </span>
            <span className="cvp-entry-date">{formatDateRange(e.startDate, e.endDate)}</span>
          </div>
          <div className="cvp-entry-org">
            {e.institution}
            {e.location ? <span className="cvp-entry-loc"> · {e.location}</span> : null}
          </div>
          {/* Neutral "Grade:" label — the schema's `grade` field has no
              declared scale (GPA, percentage, classification, ...), so
              this never guesses one. Same convention as every other
              template. */}
          {e.grade && <div className="cvp-entry-meta">Grade: {e.grade}</div>}
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
          <SectionHeading title="Profile" />
          <p className="cvp-summary">{normalizeParagraph(content.summary)}</p>
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

function renderSecondarySection(content: CvContent, section: CvSection) {
  switch (section) {
    case 'skills':
      // A vertical list, not Modern's chips or Minimal's inline run — a
      // plain competency list reads more like an executive CV's
      // "Areas of Expertise" block. Every skill is preserved completely
      // (ordinary wrapped text, never truncated); no proficiency
      // indicator, since CvSkillEntry.level is free text, not a rating.
      if (!content.skills.length) return null;
      return (
        <div key="skills">
          <SectionHeading title="Expertise" />
          <ul className="cvp-list">
            {content.skills.map((s) => (
              <li key={s.id}>
                {s.name}
                {s.level ? <span className="cvp-list-level"> · {s.level}</span> : null}
              </li>
            ))}
          </ul>
        </div>
      );
    case 'languages':
      if (!content.languages.length) return null;
      return (
        <div key="languages">
          <SectionHeading title="Languages" />
          <ul className="cvp-list">
            {content.languages.map((l) => (
              <li key={l.id}>
                {l.name}
                {l.level ? <span className="cvp-list-level"> — {l.level}</span> : null}
              </li>
            ))}
          </ul>
        </div>
      );
    case 'certifications':
      if (!content.certifications.length) return null;
      return (
        <div key="certifications">
          <SectionHeading title="Certifications" />
          {content.certifications.map((c: CvCertificationEntry) => (
            <div className="cvp-cert" key={c.id}>
              <div className="cvp-cert-name">{c.name}</div>
              {(c.issuer || c.date) && (
                <div className="cvp-cert-meta">
                  {[c.issuer, c.date].filter(Boolean).join(' · ')}
                </div>
              )}
            </div>
          ))}
        </div>
      );
    default:
      return null;
  }
}

function partitionSections(
  order: readonly CvSection[],
  secondarySections: readonly CvSection[],
): { main: CvSection[]; secondary: CvSection[] } {
  const secondarySet = new Set(secondarySections);
  return {
    main: order.filter((s) => !secondarySet.has(s)),
    secondary: order.filter((s) => secondarySet.has(s)),
  };
}

export function ProfessionalCvDocument({ content }: { content: CvContent }) {
  const { personalDetails: pd, sectionOrder } = content;
  const order = sectionOrder.length > 0 ? sectionOrder : DEFAULT_SECTION_ORDER;
  const { main, secondary } = partitionSections(order, PROFESSIONAL_TEMPLATE.sidebarSections ?? []);
  const [nameFontSize, nameRef] = useProfessionalNameFontSize(pd.fullName || 'Your Name');

  // Same deliberate two-group contact arrangement proven on Minimal: one
  // line of factual personal details, one line of professional links —
  // isolates long URLs onto their own line and keeps the header from
  // being crowded by one long dumped line.
  const personalLine = [pd.email, pd.phone, pd.location].filter(Boolean);
  const linkNodes = [
    pd.linkedIn ? <ContactItem key="linkedin" href={pd.linkedIn} /> : null,
    pd.website ? <ContactItem key="website" href={pd.website} /> : null,
  ].filter(Boolean);

  return (
    <div className="cv-professional-doc">
      <div className="cvp-header">
        <h1 ref={nameRef} style={{ fontSize: `${nameFontSize}pt` }}>
          {pd.fullName || 'Your Name'}
        </h1>
        {pd.jobTitle && <p className="cvp-job-title">{pd.jobTitle}</p>}
        {(personalLine.length > 0 || linkNodes.length > 0) && (
          <div className="cvp-contact">
            {personalLine.length > 0 && (
              <p className="cvp-contact-line">{personalLine.join('   ·   ')}</p>
            )}
            {linkNodes.length > 0 && (
              <p className="cvp-contact-line">
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
      </div>

      <div className="cvp-body">
        <div className="cvp-main">{main.map((section) => renderMainSection(content, section))}</div>
        <div className="cvp-secondary">
          {secondary.map((section) => renderSecondarySection(content, section))}
        </div>
      </div>
    </div>
  );
}

/** Plain CSS built from PROFESSIONAL_TEMPLATE's tokens — same pattern as
 *  every other template. Scoped under `.cv-professional-doc`. */
export function buildProfessionalCss(template: TemplateDefinition): string {
  const { typography: t, colors: c, spacing: s } = template;
  const secondaryPct = Math.round((template.sidebarWidthRatio ?? 0.35) * 100);
  const headerBg = template.colors.headerBackground ?? c.text;
  const headerText = template.colors.headerText ?? '#FFFFFF';
  const headerMuted = template.colors.headerMutedText ?? c.muted;
  return `
.cv-professional-doc {
  font-family: ${t.fontFamily};
  color: ${c.text};
  font-size: ${t.bodySize}pt;
  line-height: 1.48;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}
.cv-professional-doc * {
  box-sizing: border-box;
}
.cv-professional-doc a {
  color: inherit;
  text-decoration: underline;
}
.cv-professional-doc .cvp-header {
  /* Fills the width of its own container rather than attempting a true
     edge-to-edge bleed — the browser preview's outer page-card padding
     is owned by the host app, not this template, so a negative-margin
     bleed trick would silently break if that padding ever changes (see
     the module report). The PDF renderer bleeds genuinely to the
     physical page edge, since PDFKit has no such parent-padding
     dependency; this is the same disclosed, minor preview/PDF
     divergence already accepted for Modern's sidebar tint. */
  background: ${headerBg};
  padding: 28pt 0 24pt;
}
.cv-professional-doc .cvp-header h1 {
  margin: 0;
  font-weight: 700;
  color: ${headerText};
  letter-spacing: -0.01em;
  line-height: 1.12;
}
.cv-professional-doc .cvp-job-title {
  margin: 6pt 0 0;
  font-size: ${t.jobTitleSize}pt;
  font-weight: 400;
  color: ${headerMuted};
  letter-spacing: 0.02em;
}
.cv-professional-doc .cvp-contact {
  margin-top: 14pt;
}
.cv-professional-doc .cvp-contact-line {
  margin: 3pt 0 0;
  font-size: ${t.metaSize}pt;
  color: ${headerMuted};
  word-break: break-word;
}
.cv-professional-doc .cvp-contact-line:first-child {
  margin-top: 0;
}
.cv-professional-doc .cvp-body {
  display: flex;
  align-items: stretch;
  gap: ${s.sectionGap}pt;
  padding-top: ${s.sectionGap + 6}pt;
}
.cv-professional-doc .cvp-main {
  flex: 1 1 auto;
  min-width: 0;
}
.cv-professional-doc .cvp-secondary {
  flex: 0 0 ${secondaryPct}%;
  max-width: ${secondaryPct}%;
  border-left: 0.75pt solid ${c.rule};
  padding-left: ${s.sectionGap}pt;
}
.cv-professional-doc .cvp-heading {
  margin-top: ${s.sectionGap}pt;
}
.cv-professional-doc .cvp-main .cvp-heading:first-child,
.cv-professional-doc .cvp-secondary .cvp-heading:first-child {
  margin-top: 0;
}
.cv-professional-doc .cvp-heading h2 {
  margin: 0 0 4pt;
  font-size: ${t.headingSize}pt;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.07em;
  color: ${c.heading};
}
.cv-professional-doc .cvp-heading::after {
  content: '';
  display: block;
  width: 26pt;
  height: 2pt;
  background: ${c.accent};
  margin-top: 4pt;
  margin-bottom: 2pt;
}
.cv-professional-doc .cvp-summary {
  margin: 8pt 0 0;
  font-size: ${t.bodySize}pt;
  color: ${c.text};
}
.cv-professional-doc .cvp-entry {
  margin-top: ${s.entryGap}pt;
  break-inside: avoid;
}
.cv-professional-doc .cvp-entry:first-child {
  margin-top: 8pt;
}
.cv-professional-doc .cvp-entry-row {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 10pt;
}
.cv-professional-doc .cvp-entry-title {
  min-width: 0;
  font-weight: 700;
  color: ${c.text};
}
.cv-professional-doc .cvp-entry-date {
  flex-shrink: 0;
  font-size: ${t.metaSize}pt;
  color: ${c.muted};
  white-space: nowrap;
}
.cv-professional-doc .cvp-entry-org {
  margin-top: 2pt;
  font-size: ${t.bodySize - 0.3}pt;
  font-weight: 700;
  color: ${c.accent};
}
.cv-professional-doc .cvp-entry-loc {
  color: ${c.muted};
  font-weight: 400;
}
.cv-professional-doc .cvp-entry-meta {
  margin-top: 2pt;
  font-size: ${t.metaSize}pt;
  color: ${c.muted};
}
.cv-professional-doc .cvp-bullets {
  margin: ${s.bulletGap + 3}pt 0 0;
  padding-left: 13pt;
  list-style: none;
}
.cv-professional-doc .cvp-bullets li {
  position: relative;
  margin-top: ${s.bulletGap}pt;
  font-size: ${t.bodySize}pt;
  color: ${c.text};
  overflow-wrap: break-word;
}
.cv-professional-doc .cvp-bullets li::before {
  content: '▪';
  position: absolute;
  left: -13pt;
  font-size: 0.7em;
  top: 0.15em;
  color: ${c.muted};
}
.cv-professional-doc .cvp-list {
  margin: 8pt 0 0;
  padding: 0;
  list-style: none;
}
.cv-professional-doc .cvp-list li {
  margin-top: 5pt;
  font-size: ${t.bodySize - 0.5}pt;
  font-weight: 600;
  color: ${c.text};
  overflow-wrap: break-word;
}
.cv-professional-doc .cvp-list li:first-child {
  margin-top: 0;
}
.cv-professional-doc .cvp-list-level {
  font-weight: 400;
  color: ${c.muted};
}
.cv-professional-doc .cvp-cert {
  margin-top: 10pt;
}
.cv-professional-doc .cvp-cert:first-child {
  margin-top: 8pt;
}
.cv-professional-doc .cvp-cert-name {
  font-weight: 700;
  color: ${c.text};
  font-size: ${t.bodySize - 0.5}pt;
}
.cv-professional-doc .cvp-cert-meta {
  margin-top: 1pt;
  color: ${c.muted};
  font-size: ${t.metaSize}pt;
}
`;
}

/** The rendered Professional stylesheet, ready to inject as a <style> tag. */
export const PROFESSIONAL_CSS = buildProfessionalCss(PROFESSIONAL_TEMPLATE);
