import type {
  CvContent,
  CvSection,
  CvWorkEntry,
  CvEducationEntry,
  CvCertificationEntry,
} from '../types/cv.types';
import { MODERN_TEMPLATE, type TemplateDefinition } from './template-types';
import {
  formatDateRange,
  normalizeExternalUrl,
  normalizeParagraph,
  shortenUrlLabel,
} from './format';
import { DEFAULT_SECTION_ORDER } from './classic-document';

/**
 * CV Template Foundation, Phase 2 — Modern, browser side. An original
 * CVPilot design (not a reproduction of any external reference — see the
 * Modern implementation report for the specific visual-quality lessons
 * learned from the customer-supplied reference and what was deliberately
 * NOT copied: no photo, no skill-proficiency dots/bars, no icons, no
 * decorative curve/wave, different accent color and composition).
 *
 * Full-width header (name/title/contact), then a two-column body: a
 * narrow sidebar (Skills/Languages/Certifications — MODERN_TEMPLATE's
 * `sidebarSections`) and a wider main column (Summary/Work
 * Experience/Education). The column ASSIGNMENT is fixed per section, not
 * a per-CV choice — this only changes where the same factual content is
 * spatially placed, never drops, duplicates, or alters it.
 */

function partitionSections(
  order: readonly CvSection[],
  sidebarSections: readonly CvSection[],
): { sidebar: CvSection[]; main: CvSection[] } {
  const sidebarSet = new Set(sidebarSections);
  return {
    sidebar: order.filter((s) => sidebarSet.has(s)),
    main: order.filter((s) => !sidebarSet.has(s)),
  };
}

function SectionHeading({ title }: { title: string }) {
  return (
    <div className="cvm-heading">
      <h2>{title}</h2>
    </div>
  );
}

// Displays a shortened label (scheme/www stripped, long paths truncated —
// see shortenUrlLabel) while the hyperlink itself always points at the
// full, untruncated URL — a long LinkedIn/website value must never
// dominate the compact contact row, but the real destination is preserved.
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
      <SectionHeading title="Work Experience" />
      {entries.map((e) => (
        <div key={e.id} className="cvm-entry">
          <div className="cvm-entry-row">
            <span className="cvm-entry-title">{e.title}</span>
            <span className="cvm-entry-date">
              {formatDateRange(e.startDate, e.endDate, e.current)}
            </span>
          </div>
          <div className="cvm-entry-org">
            {e.company}
            {e.location ? <span className="cvm-entry-loc"> · {e.location}</span> : null}
          </div>
          {e.bullets.length > 0 && (
            <ul className="cvm-bullets">
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
        <div key={e.id} className="cvm-entry">
          <div className="cvm-entry-row">
            <span className="cvm-entry-title">
              {e.degree}
              {e.field ? ` — ${e.field}` : ''}
            </span>
            <span className="cvm-entry-date">{formatDateRange(e.startDate, e.endDate)}</span>
          </div>
          <div className="cvm-entry-org">
            {e.institution}
            {e.location ? <span className="cvm-entry-loc"> · {e.location}</span> : null}
          </div>
          {e.grade && <div className="cvm-entry-meta">Grade: {e.grade}</div>}
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
        <div className="cvm-cert" key={c.id}>
          <div className="cvm-cert-name">{c.name}</div>
          {(c.issuer || c.date) && (
            <div className="cvm-cert-meta">{[c.issuer, c.date].filter(Boolean).join(' · ')}</div>
          )}
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
          <p className="cvm-summary">{normalizeParagraph(content.summary)}</p>
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

function renderSidebarSection(content: CvContent, section: CvSection) {
  switch (section) {
    case 'skills':
      if (!content.skills.length) return null;
      return (
        <div key="skills">
          <SectionHeading title="Skills" />
          <div className="cvm-chips">
            {content.skills.map((s) => (
              <span className="cvm-chip" key={s.id}>
                {s.name}
                {s.level ? ` · ${s.level}` : ''}
              </span>
            ))}
          </div>
        </div>
      );
    case 'languages':
      if (!content.languages.length) return null;
      return (
        <div key="languages">
          <SectionHeading title="Languages" />
          <div className="cvm-list">
            {content.languages.map((l) => (
              <div className="cvm-list-row" key={l.id}>
                <span className="cvm-list-name">{l.name}</span>
                {l.level && <span className="cvm-list-level">{l.level}</span>}
              </div>
            ))}
          </div>
        </div>
      );
    case 'certifications':
      return <CertificationsSection key="certs" certs={content.certifications} />;
    default:
      return null;
  }
}

export function ModernCvDocument({ content }: { content: CvContent }) {
  const { personalDetails: pd, sectionOrder } = content;
  const order = sectionOrder.length > 0 ? sectionOrder : DEFAULT_SECTION_ORDER;
  const { sidebar, main } = partitionSections(order, MODERN_TEMPLATE.sidebarSections ?? []);

  return (
    <div className="cv-modern-doc">
      <div className="cvm-header">
        <h1>{pd.fullName || 'Your Name'}</h1>
        {pd.jobTitle && <p className="cvm-job-title">{pd.jobTitle}</p>}
        <div className="cvm-header-rule" />
        <p className="cvm-contact">
          {[
            pd.email ? <span key="email">{pd.email}</span> : null,
            pd.phone ? <span key="phone">{pd.phone}</span> : null,
            pd.location ? <span key="location">{pd.location}</span> : null,
            pd.linkedIn ? <ContactItem key="linkedin" href={pd.linkedIn} /> : null,
            pd.website ? <ContactItem key="website" href={pd.website} /> : null,
          ]
            .filter(Boolean)
            .map((node, i, arr) => (
              <span key={i}>
                {node}
                {i < arr.length - 1 ? '   ·   ' : ''}
              </span>
            ))}
        </p>
      </div>

      <div className="cvm-body">
        <div className="cvm-sidebar">
          {sidebar.map((section) => renderSidebarSection(content, section))}
        </div>
        <div className="cvm-main">{main.map((section) => renderMainSection(content, section))}</div>
      </div>
    </div>
  );
}

/** Plain CSS built from MODERN_TEMPLATE's tokens — same pattern as
 *  classic-document.tsx's buildClassicCss. Scoped under `.cv-modern-doc`. */
export function buildModernCss(template: TemplateDefinition): string {
  const { typography: t, colors: c, spacing: s } = template;
  const sidebarPct = Math.round((template.sidebarWidthRatio ?? 0.34) * 100);
  return `
.cv-modern-doc {
  font-family: ${t.fontFamily};
  color: ${c.text};
  font-size: ${t.bodySize}pt;
  line-height: 1.5;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}
.cv-modern-doc * {
  box-sizing: border-box;
}
.cv-modern-doc a {
  color: inherit;
  text-decoration: underline;
}
.cv-modern-doc .cvm-header h1 {
  margin: 0;
  font-size: ${t.nameSize}pt;
  font-weight: 700;
  color: ${c.text};
  letter-spacing: -0.015em;
  line-height: 1.1;
}
.cv-modern-doc .cvm-job-title {
  margin: 4pt 0 0;
  font-size: ${t.jobTitleSize}pt;
  font-weight: 500;
  color: ${c.accent};
  letter-spacing: 0.03em;
}
.cv-modern-doc .cvm-header-rule {
  height: 2.5pt;
  width: 54pt;
  background: ${c.accent};
  margin: 11pt 0 9pt;
}
.cv-modern-doc .cvm-contact {
  margin: 0;
  font-size: ${t.metaSize}pt;
  color: ${c.muted};
  letter-spacing: 0.01em;
  word-break: break-word;
}
.cv-modern-doc .cvm-body {
  display: flex;
  align-items: stretch;
  gap: ${s.sectionGap}pt;
  margin-top: ${s.sectionGap + 2}pt;
}
.cv-modern-doc .cvm-sidebar {
  flex: 0 0 ${sidebarPct}%;
  max-width: ${sidebarPct}%;
  background: ${template.sidebarBackground ?? 'transparent'};
  padding: ${s.sectionGap}pt;
}
.cv-modern-doc .cvm-main {
  flex: 1 1 auto;
  min-width: 0;
}
.cv-modern-doc .cvm-heading {
  margin-top: ${s.sectionGap}pt;
}
.cv-modern-doc .cvm-sidebar .cvm-heading:first-child,
.cv-modern-doc .cvm-main .cvm-heading:first-child {
  margin-top: 0;
}
.cv-modern-doc .cvm-heading h2 {
  margin: 0 0 4pt;
  font-size: ${t.headingSize}pt;
  font-weight: 700;
  color: ${c.heading};
  letter-spacing: -0.005em;
}
.cv-modern-doc .cvm-heading::after {
  content: '';
  display: block;
  width: 26pt;
  height: 2pt;
  background: ${c.accent};
  margin-top: 4pt;
  margin-bottom: 3pt;
}
.cv-modern-doc .cvm-summary {
  margin: 0;
  font-size: ${t.bodySize}pt;
  color: ${c.text};
}
.cv-modern-doc .cvm-entry {
  margin-top: ${s.entryGap}pt;
  break-inside: avoid;
}
.cv-modern-doc .cvm-entry:first-child {
  margin-top: 0;
}
.cv-modern-doc .cvm-entry-row {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 8pt;
}
.cv-modern-doc .cvm-entry-title {
  min-width: 0;
  font-weight: 700;
  color: ${c.text};
}
.cv-modern-doc .cvm-entry-date {
  flex-shrink: 0;
  font-size: ${t.metaSize}pt;
  color: ${c.muted};
  white-space: nowrap;
}
.cv-modern-doc .cvm-entry-org {
  margin-top: 1pt;
  font-size: ${t.bodySize - 0.7}pt;
  font-weight: 600;
  color: ${c.accent};
  letter-spacing: 0.01em;
}
.cv-modern-doc .cvm-entry-loc {
  color: ${c.muted};
  font-weight: 400;
}
.cv-modern-doc .cvm-entry-meta {
  font-size: ${t.metaSize}pt;
  color: ${c.muted};
}
.cv-modern-doc .cvm-bullets {
  margin: ${s.bulletGap + 2}pt 0 0;
  padding-left: 13pt;
}
.cv-modern-doc .cvm-bullets li {
  margin-top: ${s.bulletGap + 1}pt;
  font-size: ${t.bodySize}pt;
  color: ${c.text};
  overflow-wrap: break-word;
}
.cv-modern-doc .cvm-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 5pt;
}
.cv-modern-doc .cvm-chip {
  display: inline-block;
  max-width: 100%;
  white-space: normal;
  overflow-wrap: anywhere;
  background: #ffffff;
  border: 0.75pt solid #bfe0dc;
  color: ${c.heading};
  border-radius: 3pt;
  padding: 2.5pt 7pt;
  font-size: ${t.metaSize}pt;
  font-weight: 600;
}
.cv-modern-doc .cvm-list-row {
  display: flex;
  justify-content: space-between;
  gap: 6pt;
  margin-top: 5pt;
}
.cv-modern-doc .cvm-list-row:first-child {
  margin-top: 0;
}
.cv-modern-doc .cvm-list-name {
  font-weight: 600;
  color: ${c.text};
  font-size: ${t.bodySize - 0.5}pt;
}
.cv-modern-doc .cvm-list-level {
  color: ${c.muted};
  font-size: ${t.metaSize}pt;
}
.cv-modern-doc .cvm-cert {
  margin-top: 8pt;
}
.cv-modern-doc .cvm-cert:first-child {
  margin-top: 0;
}
.cv-modern-doc .cvm-cert-name {
  font-weight: 700;
  color: ${c.text};
  font-size: ${t.bodySize - 0.5}pt;
}
.cv-modern-doc .cvm-cert-meta {
  margin-top: 1pt;
  color: ${c.muted};
  font-size: ${t.metaSize}pt;
}
`;
}

export const MODERN_CSS = buildModernCss(MODERN_TEMPLATE);
