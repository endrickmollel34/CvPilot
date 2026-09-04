import type { CvContent } from '@cvpilot/shared';

import type { CvEntity } from '../../entities/cv.entity';

/**
 * Resolves the CV text to ground cover-letter generation in.
 *
 * Upload CVs only ever populate `parsedContent` (raw text extracted from the
 * PDF/DOCX by ParsingService) — `content` stays unset, since CvService's
 * updateContent() forbids editing upload-sourced CVs. Builder/prefill/
 * tailored CVs are the opposite: their usable content lives entirely in the
 * structured `content` field, and `parsedContent` is never populated —
 * CvService.createBuilder/prefillFromUpload/createTailored all mark
 * parseStatus 'done' immediately without ever queuing a parsing job. A CV
 * with `content` set is preferred when both happen to be present, since it
 * reflects the user's current edits rather than the original upload's
 * extraction.
 *
 * Returns undefined when neither source has genuinely usable content, so
 * callers can treat that the same as "still parsing" — including a
 * structured `content` that is present but empty (e.g. saved before the
 * user filled anything in), which must not bypass validation.
 */
export function resolveCoverLetterCvText(cv: CvEntity): string | undefined {
  if (hasUsableStructuredContent(cv.content)) {
    return serializeCvContent(cv.content);
  }

  const parsed = cv.parsedContent?.trim();
  return parsed ? parsed : undefined;
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

// Serializes structured CvContent to readable text for the AI — mirrors
// TailoringAiService's serializeCvContent (kept separate rather than shared
// to avoid coupling the two modules over a formatting detail).
function serializeCvContent(content: CvContent): string {
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

  if (pd.fullName) lines.push(`Name: ${pd.fullName}`);
  if (pd.jobTitle) lines.push(`Current title: ${pd.jobTitle}`);

  if (summary) {
    lines.push('\nSUMMARY:');
    lines.push(summary);
  }

  if (workExperience.length) {
    lines.push('\nWORK EXPERIENCE:');
    for (const e of workExperience) {
      const range = e.current ? `${e.startDate} – Present` : `${e.startDate} – ${e.endDate ?? ''}`;
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
