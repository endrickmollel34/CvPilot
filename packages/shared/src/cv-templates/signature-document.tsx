import { useLayoutEffect, useRef, useState } from 'react';
import type {
  CvContent,
  CvSection,
  CvWorkEntry,
  CvEducationEntry,
  CvCertificationEntry,
} from '../types/cv.types';
import { SIGNATURE_TEMPLATE, type TemplateDefinition } from './template-types';
import {
  formatDateRange,
  normalizeExternalUrl,
  normalizeParagraph,
  shortenUrlLabel,
} from './format';
import { DEFAULT_SECTION_ORDER } from './classic-document';

/**
 * CV Template Foundation, Phase 6 — Signature, browser side. See
 * SIGNATURE_TEMPLATE's doc comment (template-types.ts) for the full design
 * rationale. Three mechanics carry the template's identity: the asymmetric
 * two-zone header (`SignatureHeader`), the 'wine-tick-label' heading
 * treatment (`SectionHeading`), and the label:value `DetailPanel` for
 * Skills/Languages/Certifications.
 */

// Adaptive name-size bounds — same technique proven on Minimal/
// Professional/Compact (see their own doc comments), re-derived here with
// Signature's own (larger) base/floor rather than importing another
// template's private implementation.
const SIGNATURE_NAME_BASE_SIZE = SIGNATURE_TEMPLATE.typography.nameSize;
const SIGNATURE_NAME_FLOOR_SIZE = 24;
const SIGNATURE_NAME_STEP = 2;

function useSignatureNameFontSize(
  name: string,
): [number, React.RefObject<HTMLHeadingElement | null>] {
  const ref = useRef<HTMLHeadingElement>(null);
  const [size, setSize] = useState(SIGNATURE_NAME_BASE_SIZE);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof document === 'undefined') return;
    const widthPx = el.clientWidth;
    if (!widthPx) return;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const words = name.split(/\s+/).filter(Boolean);
    let chosen = SIGNATURE_NAME_BASE_SIZE;
    for (
      let candidate = SIGNATURE_NAME_BASE_SIZE;
      candidate >= SIGNATURE_NAME_FLOOR_SIZE;
      candidate -= SIGNATURE_NAME_STEP
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

/** Signature's sixth, genuinely distinct heading treatment — a vertical
 *  wine tick beside an uppercase, tracked CHARCOAL label. No rule at all,
 *  drawn or inline (see HeadingTreatment's 'wine-tick-label' doc comment
 *  for why every other template's rule mechanic is deliberately absent
 *  here). */
function SectionHeading({ title }: { title: string }) {
  return (
    <div className="cvs-heading">
      <span className="cvs-heading-tick" aria-hidden="true" />
      <h2>{title}</h2>
    </div>
  );
}

function ContactLine({ href }: { href: string }) {
  const url = normalizeExternalUrl(href);
  const label = shortenUrlLabel(href, 30);
  if (!url) return <span className="cvs-contact-line">{label}</span>;
  return (
    <a className="cvs-contact-line" href={url} target="_blank" rel="noreferrer">
      {label}
    </a>
  );
}

/**
 * The asymmetric editorial header — Signature's primary identity mark.
 * Two zones side by side, ONLY across this header row (the body below is
 * plain single-column, so this never becomes a persistent side column
 * like Modern's/Professional's `sidebar-main`):
 *
 *  - LEFT (dominant): the job title rendered as a small tracked wine
 *    "eyebrow" ABOVE the name — every other template puts the title
 *    below/after the name — then the large adaptive-sized name, then a
 *    short wine rule directly beneath it.
 *  - RIGHT (secondary): a small, non-full-bleed tinted card
 *    (`colors.headerBackground`) holding the contact details as quiet
 *    stacked lines. Deliberately NOT full-bleed and NOT behind the name —
 *    see that field's own doc comment for why this reuse doesn't collapse
 *    into Professional's identity.
 *
 * A full-width hairline rule closes the header before the body starts.
 */
function SignatureHeader({ content }: { content: CvContent }) {
  const { personalDetails: pd } = content;
  const [nameFontSize, nameRef] = useSignatureNameFontSize(pd.fullName || 'Your Name');

  const contactLines: Array<{ key: string; node: React.ReactNode }> = [];
  if (pd.email)
    contactLines.push({ key: 'email', node: <span className="cvs-contact-line">{pd.email}</span> });
  if (pd.phone || pd.location) {
    contactLines.push({
      key: 'phone-loc',
      node: (
        <span className="cvs-contact-line">
          {[pd.phone, pd.location].filter(Boolean).join('   ·   ')}
        </span>
      ),
    });
  }
  if (pd.linkedIn) contactLines.push({ key: 'linkedin', node: <ContactLine href={pd.linkedIn} /> });
  if (pd.website) contactLines.push({ key: 'website', node: <ContactLine href={pd.website} /> });

  return (
    <div className="cvs-header">
      <div className="cvs-header-row">
        <div className="cvs-header-left">
          {pd.jobTitle && <p className="cvs-eyebrow">{pd.jobTitle}</p>}
          <h1 ref={nameRef} style={{ fontSize: `${nameFontSize}pt` }}>
            {pd.fullName || 'Your Name'}
          </h1>
          <div className="cvs-name-rule" />
        </div>
        {contactLines.length > 0 && (
          <div className="cvs-header-right">
            <div className="cvs-contact-card">
              {contactLines.map((c) => (
                <div key={c.key}>{c.node}</div>
              ))}
            </div>
          </div>
        )}
      </div>
      <div className="cvs-header-close-rule" />
    </div>
  );
}

function WorkEntries({ entries }: { entries: CvWorkEntry[] }) {
  if (!entries.length) return null;
  return (
    <>
      <SectionHeading title="Experience" />
      {entries.map((e) => (
        <div key={e.id} className="cvs-entry">
          <div className="cvs-entry-row">
            <span className="cvs-entry-role">{e.title}</span>
            <span className="cvs-entry-date">
              {formatDateRange(e.startDate, e.endDate, e.current)}
            </span>
          </div>
          <div className="cvs-entry-org">
            {e.company}
            {e.location ? <span className="cvs-entry-loc"> · {e.location}</span> : null}
          </div>
          {e.bullets.length > 0 && (
            <ul className="cvs-bullets">
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
        <div key={e.id} className="cvs-entry">
          <div className="cvs-entry-row">
            <span className="cvs-entry-role">
              {e.degree}
              {e.field ? ` — ${e.field}` : ''}
            </span>
            <span className="cvs-entry-date">{formatDateRange(e.startDate, e.endDate)}</span>
          </div>
          <div className="cvs-entry-org">
            {e.institution}
            {e.location ? <span className="cvs-entry-loc"> · {e.location}</span> : null}
          </div>
          {/* Neutral "Grade:" label — the schema's `grade` field has no
              declared scale, so this never guesses one (e.g. never "GPA:").
              Same convention as every other template. */}
          {e.grade && <div className="cvs-entry-meta">Grade: {e.grade}</div>}
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
          <p className="cvs-summary">{normalizeParagraph(content.summary)}</p>
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
 * Signature's one structural signature for secondary information: Skills,
 * Languages, and Certifications become label:value ROWS inside a single
 * framed panel — one hairline rule above the first row, one below the
 * last — rather than Modern's/Professional's persistent sidebar column or
 * Compact's horizontal three-column footer band. Only present sections
 * become a row; if none are present, the whole panel (including its
 * rules) is omitted, so the layout collapses naturally with no visible
 * hole. Skills/Languages render as a single wrapped inline run; multiple
 * Certifications stack within their one row's value column as name+meta
 * pairs, never repeating the "Certifications" label per item.
 */
function DetailPanel({ content }: { content: CvContent }) {
  const hasSkills = content.skills.length > 0;
  const hasLanguages = content.languages.length > 0;
  const hasCerts = content.certifications.length > 0;
  if (!hasSkills && !hasLanguages && !hasCerts) return null;

  return (
    <div className="cvs-panel">
      {hasSkills && (
        <div className="cvs-panel-row">
          <div className="cvs-panel-label">Skills</div>
          <div className="cvs-panel-value">
            {content.skills
              .map((s) => (s.level ? `${s.name} (${s.level})` : s.name))
              .join('   ·   ')}
          </div>
        </div>
      )}
      {hasLanguages && (
        <div className="cvs-panel-row">
          <div className="cvs-panel-label">Languages</div>
          <div className="cvs-panel-value">
            {content.languages
              .map((l) => (l.level ? `${l.name} (${l.level})` : l.name))
              .join('   ·   ')}
          </div>
        </div>
      )}
      {hasCerts && (
        <div className="cvs-panel-row">
          <div className="cvs-panel-label">Certifications</div>
          <div className="cvs-panel-value">
            {content.certifications.map((c: CvCertificationEntry) => (
              <div className="cvs-cert" key={c.id}>
                <span className="cvs-cert-name">{c.name}</span>
                {(c.issuer || c.date) && (
                  <span className="cvs-cert-meta">
                    {' '}
                    — {[c.issuer, c.date].filter(Boolean).join(', ')}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function SignatureCvDocument({ content }: { content: CvContent }) {
  const { sectionOrder } = content;
  const order = sectionOrder.length > 0 ? sectionOrder : DEFAULT_SECTION_ORDER;
  const secondarySet = new Set(SIGNATURE_TEMPLATE.sidebarSections ?? []);
  const mainSections = order.filter((s) => !secondarySet.has(s));

  return (
    <div className="cv-signature-doc">
      <SignatureHeader content={content} />
      {mainSections.map((section) => renderMainSection(content, section))}
      <DetailPanel content={content} />
    </div>
  );
}

/** Plain CSS built from SIGNATURE_TEMPLATE's tokens — same pattern as
 *  every other template. Scoped under `.cv-signature-doc`. */
export function buildSignatureCss(template: TemplateDefinition): string {
  const { typography: t, colors: c, spacing: s } = template;
  return `
.cv-signature-doc {
  font-family: ${t.fontFamily};
  color: ${c.text};
  font-size: ${t.bodySize}pt;
  line-height: 1.5;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}
.cv-signature-doc * {
  box-sizing: border-box;
}
.cv-signature-doc a {
  color: inherit;
  text-decoration: underline;
}
.cv-signature-doc .cvs-header-row {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 20pt;
}
.cv-signature-doc .cvs-header-left {
  flex: 1 1 auto;
  min-width: 0;
}
.cv-signature-doc .cvs-eyebrow {
  margin: 0;
  font-size: ${t.jobTitleSize}pt;
  font-weight: 700;
  color: ${c.accent};
  text-transform: uppercase;
  letter-spacing: 0.09em;
}
.cv-signature-doc .cvs-header-left h1 {
  margin: 4pt 0 0;
  font-weight: 700;
  color: ${c.heading};
  letter-spacing: -0.01em;
  line-height: 1.08;
}
.cv-signature-doc .cvs-name-rule {
  width: 40pt;
  height: 2pt;
  background: ${c.accent};
  margin-top: 10pt;
}
.cv-signature-doc .cvs-header-right {
  flex: 0 0 auto;
  width: 30%;
  max-width: 145pt;
}
.cv-signature-doc .cvs-contact-card {
  background: ${c.headerBackground ?? 'transparent'};
  padding: 10pt 8pt;
  display: flex;
  flex-direction: column;
  gap: 4pt;
}
.cv-signature-doc .cvs-contact-line {
  font-size: ${t.metaSize}pt;
  color: ${c.muted};
  word-break: break-word;
}
.cv-signature-doc .cvs-header-close-rule {
  height: 0.75pt;
  background: ${c.rule};
  margin-top: 16pt;
}
.cv-signature-doc .cvs-heading {
  display: flex;
  align-items: center;
  gap: 8pt;
  margin-top: ${s.sectionGap}pt;
}
.cv-signature-doc .cvs-heading:first-of-type {
  margin-top: ${s.sectionGap + 6}pt;
}
.cv-signature-doc .cvs-heading .cvs-heading-tick {
  flex-shrink: 0;
  width: 2.5pt;
  height: 11pt;
  background: ${c.accent};
}
.cv-signature-doc .cvs-heading h2 {
  margin: 0;
  font-size: ${t.headingSize}pt;
  font-weight: 700;
  color: ${c.heading};
  text-transform: uppercase;
  letter-spacing: 0.075em;
}
.cv-signature-doc .cvs-summary {
  margin: 7pt 0 0;
  font-size: ${t.bodySize}pt;
  color: ${c.text};
}
.cv-signature-doc .cvs-entry {
  margin-top: ${s.entryGap}pt;
  break-inside: avoid;
}
.cv-signature-doc .cvs-entry:first-of-type {
  margin-top: 8pt;
}
.cv-signature-doc .cvs-entry-row {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 10pt;
}
.cv-signature-doc .cvs-entry-role {
  min-width: 0;
  font-weight: 700;
  font-size: ${t.bodySize}pt;
  color: ${c.heading};
}
.cv-signature-doc .cvs-entry-date {
  flex-shrink: 0;
  font-size: ${t.metaSize}pt;
  color: ${c.muted};
  white-space: nowrap;
}
.cv-signature-doc .cvs-entry-org {
  margin-top: 2pt;
  font-size: ${t.bodySize - 0.3}pt;
  font-weight: 700;
  color: ${c.accent};
}
.cv-signature-doc .cvs-entry-loc {
  color: ${c.muted};
  font-weight: 400;
}
.cv-signature-doc .cvs-entry-meta {
  margin-top: 2pt;
  font-size: ${t.metaSize}pt;
  color: ${c.muted};
}
.cv-signature-doc .cvs-bullets {
  margin: ${s.bulletGap + 2}pt 0 0;
  padding-left: 13pt;
  list-style: none;
}
.cv-signature-doc .cvs-bullets li {
  position: relative;
  margin-top: ${s.bulletGap}pt;
  font-size: ${t.bodySize}pt;
  color: ${c.text};
  overflow-wrap: break-word;
}
.cv-signature-doc .cvs-bullets li::before {
  content: '»';
  position: absolute;
  left: 0;
  color: ${c.muted};
}
.cv-signature-doc .cvs-panel {
  margin-top: ${s.sectionGap}pt;
  padding: 10pt 0;
  border-top: 0.75pt solid ${c.rule};
  border-bottom: 0.75pt solid ${c.rule};
}
.cv-signature-doc .cvs-panel-row {
  display: flex;
  gap: 16pt;
  padding: 5pt 0;
}
.cv-signature-doc .cvs-panel-row + .cvs-panel-row {
  border-top: 0.5pt solid ${c.rule};
}
.cv-signature-doc .cvs-panel-label {
  flex: 0 0 auto;
  width: 100pt;
  font-size: ${t.metaSize}pt;
  font-weight: 700;
  color: ${c.heading};
  text-transform: uppercase;
  letter-spacing: 0.07em;
}
.cv-signature-doc .cvs-panel-value {
  flex: 1 1 auto;
  min-width: 0;
  font-size: ${t.bodySize - 0.2}pt;
  color: ${c.text};
  overflow-wrap: break-word;
}
.cv-signature-doc .cvs-cert {
  margin-top: 4pt;
}
.cv-signature-doc .cvs-cert:first-child {
  margin-top: 0;
}
.cv-signature-doc .cvs-cert-name {
  font-weight: 700;
  color: ${c.text};
}
.cv-signature-doc .cvs-cert-meta {
  color: ${c.muted};
}
`;
}

/** The rendered Signature stylesheet, ready to inject as a <style> tag. */
export const SIGNATURE_CSS = buildSignatureCss(SIGNATURE_TEMPLATE);
