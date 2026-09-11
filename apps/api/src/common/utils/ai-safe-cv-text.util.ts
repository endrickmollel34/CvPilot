import type { CvContent } from '@cvpilot/shared';

import type { CvEntity } from '../../entities/cv.entity';

/**
 * AI data-minimization resolver (Analysis + Cover Letter share this — see
 * each module's own call site). Builds the exact CV text handed to an
 * external AI provider, with direct personal identifiers removed wherever
 * that's genuinely safe to do, while preserving everything the AI actually
 * needs to do its job: job titles, employers, dates, responsibilities,
 * achievements, education, certifications, skills, languages, and summary
 * content are never touched.
 *
 * Two independent code paths, because CVPilot's own CV data has two shapes:
 *
 *  - STRUCTURED (`cv.content`, populated for builder/prefill/tailored CVs):
 *    fields are already typed and separated, so personalDetails can simply
 *    be omitted field-by-field with zero ambiguity. `includeFullName`
 *    controls the one field that's genuinely caller-dependent (Cover Letter
 *    needs the candidate's name; Analysis's match-scoring never does).
 *    `jobTitle` is always included — it's professional context (the
 *    candidate's current role), not a contact identifier, and every caller
 *    wants it.
 *
 *  - RAW (`cv.parsedContent`, the only field ever populated for upload
 *    CVs): plain extracted text with no field boundaries at all — there is
 *    no way to know "this line is the contact block" vs "this line is a
 *    project bullet" without full NLP/NER, which is out of scope for an
 *    MVP fix. Only patterns with a genuinely unambiguous, low-false-
 *    positive SHAPE are redacted here: email addresses, LinkedIn personal-
 *    profile URLs, and internationally-formatted (leading "+") phone
 *    numbers. Deliberately NOT attempted: stripping the candidate's name
 *    (indistinguishable from any other proper noun — a company, a
 *    project, a technology), physical addresses (no fixed format, and
 *    directly overlaps with legitimate employer/institution `location`
 *    text, e.g. "Cupertino, CA" is both a plausible home city and Apple's
 *    own address), bare/local-format phone numbers (too easily confused
 *    with achievement metrics or unusually-formatted date ranges), or any
 *    other URL (a portfolio/GitHub/project link inside a work-experience
 *    bullet is genuine evidence, not a contact identifier — blanket URL
 *    removal would destroy exactly the kind of content this function must
 *    preserve).
 *
 * Called on a COPY only — `cv.parsedContent`/`cv.content` themselves are
 * never mutated; every function here returns a new string/derived value.
 */

export interface AiSafeTextOptions {
  /**
   * Whether to include the candidate's own full name in the text sent to
   * the AI provider. Cover Letter genuinely needs it (used to address the
   * letter); Analysis's match-scoring never does — a name has no bearing
   * on whether the CV's skills/experience match a job description.
   */
  includeFullName: boolean;
}

/**
 * Resolves the exact CV text to send to an external AI provider — prefers
 * structured `content` when usable, falls back to a redacted copy of raw
 * `parsedContent`. Mirrors the existing structured/raw preference already
 * established for Cover Letter (a structured edit is always more current
 * than a stale original upload extraction, when both happen to be present).
 *
 * Returns undefined when neither source has genuinely usable content —
 * callers should treat that as "not ready" (matches the pre-existing
 * resolveCoverLetterCvText/Analysis parsedContent-required contracts).
 */
export function resolveAiSafeCvText(
  cv: Pick<CvEntity, 'content' | 'parsedContent'>,
  options: AiSafeTextOptions,
): string | undefined {
  if (hasUsableStructuredContent(cv.content)) {
    return serializeCvContentForAi(cv.content, options);
  }

  const parsed = cv.parsedContent?.trim();
  return parsed ? redactRawCvTextForAi(parsed) : undefined;
}

function hasUsableStructuredContent(content: CvContent | undefined): content is CvContent {
  if (!content) return false;
  return (
    !!content.personalDetails?.fullName?.trim() ||
    !!content.summary?.trim() ||
    content.workExperience.length > 0 ||
    content.education.length > 0 ||
    content.skills.length > 0 ||
    content.languages.length > 0 ||
    content.certifications.length > 0
  );
}

// Serializes structured CvContent to readable text for an AI provider.
// personalDetails.email/phone/location/linkedIn/website are deliberately
// NEVER included here, for either caller — see the module doc comment.
// jobTitle and (conditionally) fullName are the only personalDetails
// fields ever emitted.
function serializeCvContentForAi(content: CvContent, options: AiSafeTextOptions): string {
  const {
    personalDetails: pd,
    summary,
    workExperience,
    education,
    skills,
    languages,
    certifications,
  } = content;
  const lines: string[] = [];

  if (options.includeFullName && pd.fullName) lines.push(`Name: ${pd.fullName}`);
  if (pd.jobTitle) lines.push(`Current title: ${pd.jobTitle}`);

  if (summary) {
    lines.push('\nSUMMARY:');
    lines.push(summary);
  }

  if (workExperience.length) {
    lines.push('\nWORK EXPERIENCE:');
    for (const e of workExperience) {
      const range = e.current ? `${e.startDate} – Present` : `${e.startDate} – ${e.endDate ?? ''}`;
      // e.location is the ROLE's location (e.g. "Remote", "London, UK") —
      // professional context about where the job was performed, not the
      // candidate's own contact address. Never redacted.
      lines.push(`  ${e.title} at ${e.company}${e.location ? ` (${e.location})` : ''} [${range}]`);
      for (const b of e.bullets) lines.push(`    • ${b}`);
    }
  }

  if (education.length) {
    lines.push('\nEDUCATION:');
    for (const e of education) {
      const deg = e.field ? `${e.degree} in ${e.field}` : e.degree;
      lines.push(`  ${deg} at ${e.institution}${e.grade ? ` (${e.grade})` : ''}`);
    }
  }

  if (skills.length) {
    lines.push(
      `\nSKILLS: ${skills.map((s) => (s.level ? `${s.name} (${s.level})` : s.name)).join(', ')}`,
    );
  }

  if (languages.length) {
    lines.push(
      `\nLANGUAGES: ${languages.map((l) => (l.level ? `${l.name} (${l.level})` : l.name)).join(', ')}`,
    );
  }

  if (certifications.length) {
    lines.push(`\nCERTIFICATIONS: ${certifications.map((c) => c.name).join(', ')}`);
  }

  return lines.join('\n');
}

// ── Raw-text redaction ──────────────────────────────────────────────────────
// Each pattern is scoped as narrowly as its own justification allows — see
// the module doc comment for what was deliberately NOT attempted and why.

// Standard `local@domain.tld` shape. Essentially zero legitimate CV content
// (dates, metrics, company names, technologies) is ever written in this
// form, so this is safe as a blanket replace.
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

// Only the personal-profile path (linkedin.com/in/...), optionally preceded
// by a protocol/www — never linkedin.com/company/... or any other LinkedIn
// path, and never a blanket "strip all URLs" rule (a portfolio/GitHub/
// project URL is genuine evidence, not a contact identifier).
const LINKEDIN_PROFILE_RE = /(https?:\/\/)?(www\.)?linkedin\.com\/in\/[A-Za-z0-9\-_%]+\/?/gi;

// Conservative phone rule: ONLY numbers with an explicit leading "+"
// international country-code prefix (e.g. "+1 555 123 4567",
// "+44 (0)20 7946 0958"). A leading "+" followed by a long digit run is,
// in CV text, essentially always a phone number — nothing else in a CV is
// written that way (achievement metrics like "+15% YoY" have far too few
// digits to match the required run length below). Deliberately does NOT
// attempt bare/local-format numbers (e.g. "020 7946 0958", "(555) 123-4567")
// — those have no equivalently reliable shape and collide too easily with
// date ranges, monetary figures, or other numeric achievements; see the
// module report for this explicit, reported limitation.
const INTL_PHONE_RE = /\+\d[\d\s().-]{6,14}\d/g;

export function redactRawCvTextForAi(text: string): string {
  return text
    .replace(EMAIL_RE, '[redacted-email]')
    .replace(LINKEDIN_PROFILE_RE, '[redacted-linkedin]')
    .replace(INTL_PHONE_RE, '[redacted-phone]');
}
