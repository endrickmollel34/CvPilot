import type { CvContent } from '@cvpilot/shared';

/**
 * Splits a candidate's CV into two evidence tiers so the possession-claim
 * guard (possession-claim-guard.util.ts) can tell "demonstrated experience"
 * apart from "listed skill only" — see that file's header comment for why
 * this distinction matters (a skills-list entry should never, by itself,
 * ground a claim of having *done* the work).
 *
 *  - `experienceText`: work experience (titles, companies, bullets),
 *    education, certifications, and summary/current-title — text that can
 *    support a claim of genuinely demonstrated, hands-on experience.
 *  - `skillsOnlyTerms`: names pulled from a skills/languages list — can
 *    support a *knowledge/familiarity* claim ("I have knowledge of X"), but
 *    never an experience-level claim ("I developed X at Employer") on their
 *    own.
 *
 * A term appearing in both (e.g. a skill also named in a work bullet) is
 * still fully experience-grounded — the two tiers are not mutually
 * exclusive, and every check the guard runs treats "found in experienceText"
 * as sufficient regardless of whether the term also happens to be listed as
 * a skill.
 */
export interface CvEvidence {
  experienceText: string;
  skillsOnlyTerms: string[];
}

/** Builds evidence tiers from structured CvContent (builder/prefill/tailored
 *  CVs) — exact and reliable, since the fields are already typed/separated. */
export function buildCvEvidenceFromContent(content: CvContent): CvEvidence {
  const experienceParts: string[] = [];

  if (content.personalDetails.jobTitle) experienceParts.push(content.personalDetails.jobTitle);
  if (content.summary) experienceParts.push(content.summary);

  for (const entry of content.workExperience) {
    experienceParts.push(entry.title, entry.company, ...entry.bullets);
  }
  for (const entry of content.education) {
    experienceParts.push(entry.degree, entry.institution);
    if (entry.field) experienceParts.push(entry.field);
  }
  for (const entry of content.certifications) {
    experienceParts.push(entry.name);
    if (entry.issuer) experienceParts.push(entry.issuer);
  }

  const skillsOnlyTerms = [
    ...content.skills.map((s) => s.name),
    ...content.languages.map((l) => l.name),
  ];

  return {
    experienceText: experienceParts.filter(Boolean).join('\n'),
    skillsOnlyTerms,
  };
}

// Recognised resume section headers, matched as a whole line (after
// trimming and stripping a trailing colon) — not a substring search, so an
// ordinary sentence that happens to contain the word "skills" is never
// mistaken for a header. Deliberately a fixed list rather than an attempt
// at general document-structure parsing (see the module's rationale for
// staying with a small, deterministic heuristic).
const SKILLS_SECTION_HEADERS = new Set([
  'skills',
  'technical skills',
  'key skills',
  'core competencies',
  'competencies',
  'skills & technologies',
  'skills and technologies',
  'technologies',
  'tech stack',
  'technical proficiencies',
  'languages',
]);

const OTHER_SECTION_HEADERS = new Set([
  'experience',
  'work experience',
  'employment history',
  'professional experience',
  'career history',
  'education',
  'certifications',
  'certification',
  'summary',
  'profile',
  'professional summary',
  'objective',
  'projects',
  'about me',
]);

const MAX_HEADER_LINE_LENGTH = 50;

function classifyHeaderLine(line: string): 'skills' | 'other' | null {
  const cleaned = line.trim().replace(/:$/, '').toLowerCase();
  if (!cleaned || cleaned.length > MAX_HEADER_LINE_LENGTH) return null;
  if (SKILLS_SECTION_HEADERS.has(cleaned)) return 'skills';
  if (OTHER_SECTION_HEADERS.has(cleaned)) return 'other';
  return null;
}

/**
 * Builds evidence tiers from raw plain-text CV content (uploaded PDF/DOCX —
 * see ParsingService), which has no machine-readable structure. This uses a
 * small, deterministic heuristic — scanning for recognisable section-header
 * lines (e.g. "Skills:", "Experience") — rather than any NLP/ML parsing.
 *
 * If no recognisable header is found at all, the whole text is treated as
 * experience evidence (today's pre-existing behaviour) rather than guessing
 * at a split that could be wrong — a real, if unusually formatted, CV must
 * never lose grounding coverage entirely because it doesn't use a
 * conventional layout.
 */
export function buildCvEvidenceFromPlainText(cvText: string): CvEvidence {
  const lines = cvText.split(/\r?\n/);
  const skillsLines: string[] = [];
  const otherLines: string[] = [];
  let currentBucket: 'skills' | 'other' = 'other';
  let sawAnyHeader = false;

  for (const line of lines) {
    const headerType = classifyHeaderLine(line);
    if (headerType) {
      currentBucket = headerType;
      sawAnyHeader = true;
      continue; // the header line itself is not evidence content
    }
    (currentBucket === 'skills' ? skillsLines : otherLines).push(line);
  }

  if (!sawAnyHeader) {
    return { experienceText: cvText, skillsOnlyTerms: [] };
  }

  const skillsOnlyTerms = skillsLines
    .join('\n')
    .split(/[,;•\n]/)
    .map((term) => term.trim())
    .filter(Boolean);

  return { experienceText: otherLines.join('\n').trim(), skillsOnlyTerms };
}
