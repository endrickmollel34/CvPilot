import type {
  CvContent,
  CvSection,
  CvWorkEntry,
  CvEducationEntry,
  CvSkillEntry,
  CvCertificationEntry,
} from '../types/cv.types';
import { CLASSIC_TEMPLATE } from './template-types';
import type { TemplateDefinition } from './template-types';
import { formatDateRange, normalizeExternalUrl } from './format';

/**
 * CV Template Foundation, Phase 1 — the single shared visual source for the
 * "Classic" CV, consumed by the browser preview (apps/web's
 * CvBuilderWorkspace.tsx). The PDF side (apps/api's pdf-generation.service.ts,
 * PDFKit) is a SEPARATE implementation — see the Template Foundation
 * decision report for why (PDFKit has no CSS/flexbox layout engine, so
 * there is no way to share the actual drawing code). What IS shared between
 * the two: this component's `CLASSIC_TEMPLATE` tokens (typography, colors,
 * spacing, margins — see template-types.ts) and the pure formatting
 * helpers in format.ts, so the two renderers can never again silently
 * drift on font/color/spacing the way the original AtsClassic.tsx (React/
 * Tailwind) and pdf-generation.service.ts (PDFKit, hardcoded constants)
 * did before this phase.
 *
 * Plain CSS, not Tailwind utility classes — kept from the original spike
 * even though Chromium/PDF-from-HTML was ultimately rejected, because it's
 * still the right choice for a template whose CSS is generated from shared
 * numeric tokens (buildClassicCss) rather than authored by hand per class.
 */

// `headingTreatment` isn't threaded through yet — only 'rule-underline'
// (expressed via the .cv-heading CSS class) exists today. Wire a real prop
// here once a second template needs a different treatment.
function SectionHeading({ title }: { title: string }) {
  return (
    <div className="cv-heading">
      <h2>{title}</h2>
    </div>
  );
}

function ContactLink({ href, label }: { href?: string; label: string }) {
  const url = normalizeExternalUrl(href);
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
        <div key={e.id} className="cv-entry">
          <div className="cv-entry-row">
            <span className="cv-entry-title">{e.title}</span>
            <span className="cv-entry-date">
              {formatDateRange(e.startDate, e.endDate, e.current)}
            </span>
          </div>
          <div className="cv-entry-subtitle">
            {e.company}
            {e.location ? `, ${e.location}` : ''}
          </div>
          {e.bullets.length > 0 && (
            <ul className="cv-bullets">
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
        <div key={e.id} className="cv-entry">
          <div className="cv-entry-row">
            <span className="cv-entry-title">
              {e.degree}
              {e.field ? ` — ${e.field}` : ''}
            </span>
            <span className="cv-entry-date">{formatDateRange(e.startDate, e.endDate)}</span>
          </div>
          <div className="cv-entry-subtitle">
            {e.institution}
            {e.location ? `, ${e.location}` : ''}
          </div>
          {e.grade && <div className="cv-entry-meta">{e.grade}</div>}
        </div>
      ))}
    </>
  );
}

function SkillsSection({ skills }: { skills: CvSkillEntry[] }) {
  if (!skills.length) return null;
  return (
    <>
      <SectionHeading title="Skills" />
      <div className="cv-chips">
        {skills.map((s) => (
          <span className="cv-chip" key={s.id}>
            {s.name}
            {s.level ? ` · ${s.level}` : ''}
          </span>
        ))}
      </div>
    </>
  );
}

function CertificationsSection({ certs }: { certs: CvCertificationEntry[] }) {
  if (!certs.length) return null;
  return (
    <>
      <SectionHeading title="Certifications" />
      {certs.map((c) => (
        <div className="cv-entry" key={c.id}>
          <span className="cv-entry-title">{c.name}</span>
          {c.issuer && <span className="cv-entry-subtitle-inline"> · {c.issuer}</span>}
          {c.date && <span className="cv-entry-meta-inline"> ({c.date})</span>}
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
          <p className="cv-summary">{content.summary}</p>
        </div>
      );
    case 'workExperience':
      return <WorkEntries key="work" entries={content.workExperience} />;
    case 'education':
      return <EducationEntries key="edu" entries={content.education} />;
    case 'skills':
      return <SkillsSection key="skills" skills={content.skills} />;
    case 'languages':
      if (!content.languages.length) return null;
      return (
        <div key="languages">
          <SectionHeading title="Languages" />
          <div className="cv-chips">
            {content.languages.map((l) => (
              <span className="cv-chip" key={l.id}>
                {l.name}
                {l.level ? ` · ${l.level}` : ''}
              </span>
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

export function ClassicCvDocument({ content }: { content: CvContent }) {
  const { personalDetails: pd, sectionOrder } = content;
  const order = sectionOrder.length > 0 ? sectionOrder : DEFAULT_SECTION_ORDER;

  return (
    <div className="cv-classic-doc">
      <div className="cv-header">
        <h1>{pd.fullName || 'Your Name'}</h1>
        {pd.jobTitle && <p className="cv-job-title">{pd.jobTitle}</p>}
        <p className="cv-contact">
          {[
            pd.email ? <span key="email">{pd.email}</span> : null,
            pd.phone ? <span key="phone">{pd.phone}</span> : null,
            pd.location ? <span key="location">{pd.location}</span> : null,
            pd.linkedIn ? (
              <ContactLink key="linkedin" href={pd.linkedIn} label={pd.linkedIn} />
            ) : null,
            pd.website ? <ContactLink key="website" href={pd.website} label={pd.website} /> : null,
          ]
            .filter(Boolean)
            .map((node, i, arr) => (
              <span key={i}>
                {node}
                {i < arr.length - 1 ? '  ·  ' : ''}
              </span>
            ))}
        </p>
      </div>
      {order.map((section) => renderSection(content, section))}
    </div>
  );
}

export const DEFAULT_SECTION_ORDER: CvSection[] = [
  'summary',
  'workExperience',
  'education',
  'skills',
  'languages',
  'certifications',
];

/**
 * Builds the plain-CSS stylesheet for ClassicCvDocument from a
 * TemplateDefinition's tokens — never hand-authored numbers duplicated
 * from pdf-generation.service.ts. Scoped entirely under `.cv-classic-doc`
 * so it can never leak into either host app's other styles.
 */
export function buildClassicCss(template: TemplateDefinition): string {
  const { typography: t, colors: c, spacing: s } = template;
  return `
.cv-classic-doc {
  font-family: ${t.fontFamily};
  color: ${c.text};
  font-size: ${t.bodySize}pt;
  line-height: 1.45;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}
.cv-classic-doc * {
  box-sizing: border-box;
}
.cv-classic-doc a {
  color: inherit;
  text-decoration: underline;
}
.cv-classic-doc .cv-header {
  text-align: center;
  margin-bottom: ${s.sectionGap}pt;
}
.cv-classic-doc .cv-header h1 {
  margin: 0;
  font-size: ${t.nameSize}pt;
  font-weight: 700;
  color: ${c.text};
}
.cv-classic-doc .cv-job-title {
  margin: 3pt 0 0;
  font-size: ${t.jobTitleSize}pt;
  color: ${c.muted};
}
.cv-classic-doc .cv-contact {
  margin: 5pt 0 0;
  font-size: ${t.metaSize - 0.5}pt;
  color: ${c.muted};
  word-break: break-word;
}
.cv-classic-doc .cv-heading {
  border-bottom: 0.5pt solid ${c.rule};
  margin-top: ${s.sectionGap}pt;
  padding-bottom: 2pt;
  break-after: avoid;
  break-inside: avoid;
}
.cv-classic-doc .cv-heading h2 {
  margin: 0;
  font-size: ${t.headingSize}pt;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: ${c.heading};
}
.cv-classic-doc .cv-summary {
  margin: 6pt 0 0;
  font-size: ${t.bodySize}pt;
  color: ${c.text};
}
.cv-classic-doc .cv-entry {
  margin-top: ${s.entryGap}pt;
  break-inside: avoid;
}
.cv-classic-doc .cv-entry-row {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 8pt;
}
.cv-classic-doc .cv-entry-title {
  min-width: 0;
  font-weight: 700;
  color: ${c.text};
}
.cv-classic-doc .cv-entry-date {
  flex-shrink: 0;
  font-size: ${t.metaSize}pt;
  color: ${c.muted};
  white-space: nowrap;
}
.cv-classic-doc .cv-entry-subtitle,
.cv-classic-doc .cv-entry-subtitle-inline {
  font-size: ${t.bodySize - 1}pt;
  color: ${c.muted};
}
.cv-classic-doc .cv-entry-meta,
.cv-classic-doc .cv-entry-meta-inline {
  font-size: ${t.metaSize}pt;
  color: ${c.muted};
}
.cv-classic-doc .cv-bullets {
  margin: ${s.bulletGap + 1}pt 0 0;
  padding-left: 14pt;
}
.cv-classic-doc .cv-bullets li {
  margin-top: ${s.bulletGap}pt;
  font-size: ${t.bodySize}pt;
  color: ${c.text};
  overflow-wrap: break-word;
}
.cv-classic-doc .cv-chips {
  margin-top: 6pt;
  display: flex;
  flex-wrap: wrap;
  gap: 4pt 6pt;
}
.cv-classic-doc .cv-chip {
  background: #f3f4f6;
  border-radius: 3pt;
  padding: 2pt 6pt;
  font-size: ${t.metaSize}pt;
  color: ${c.text};
}
`;
}

/** The rendered Classic stylesheet, ready to inject as a <style> tag. */
export const CLASSIC_CSS = buildClassicCss(CLASSIC_TEMPLATE);
