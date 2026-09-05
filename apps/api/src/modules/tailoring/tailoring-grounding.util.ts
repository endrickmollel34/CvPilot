import type {
  CvContent,
  CvEducationEntry,
  CvWorkEntry,
  TailoringSuggestion,
} from '@cvpilot/shared';
import { isNewSkillGrounded } from './skill-grounding.util';

/**
 * Tailoring Grounding V2 — per-suggestion evidence-level classification.
 *
 * Root cause this replaces: the pre-V2 filter in TailoringService.runTailoring
 * only ever validated suggestions for `section === 'skills' | 'languages'`
 * (via isNewSkillGrounded) — every summary/workExperience/education/
 * certifications suggestion passed through completely unchecked:
 *
 *   if (s.section !== 'skills' && s.section !== 'languages') return true;
 *
 * That gap is exactly what production exploited: a summary rewrite that
 * upgraded "developing and maintaining backend applications" into "a
 * strong background in developing and maintaining backend applications,"
 * or a work-experience bullet that broadened "VIP reception" into
 * "corporate events" and "conferences," went straight through with zero
 * grounding checks at all, because neither is a skills/languages addition.
 *
 * This module checks EVERY suggestion, regardless of section, and assigns
 * one evidence level:
 *
 *   EXACT        Already explicitly present (suggestedContent ==
 *                originalContent) — always allowed.
 *   PARAPHRASE   Same factual meaning, reworded — allowed.
 *   REORDER      Same words, different order — allowed.
 *   EMPHASIS     Existing evidence made more visible (e.g. a genuinely
 *                grounded new summary line) — allowed, unless it also
 *                raises the intensity level (then it's STRENGTHENED).
 *   UNSUPPORTED  A new fact — skill, certification, responsibility, soft
 *                skill/methodology (teamwork, agile, leadership, mentoring,
 *                cloud experience, ...) — not evidenced in the relevant
 *                evidence scope. Rejected.
 *   STRENGTHENED An existing fact's intensity is exaggerated (extensive,
 *                strong background, highly experienced, expert, proficient,
 *                ...) beyond what the relevant evidence scope supports.
 *                Rejected.
 *   BROADENED    The scope of an existing fact is expanded into something
 *                bigger/different (VIP reception → corporate events,
 *                undergraduate → graduate, a Skills-only "Docker" attributed
 *                to a specific job that never mentions it) — not evidenced
 *                in the relevant evidence scope. Rejected.
 *
 * V2.1 (cross-entry evidence scoping): V2 checked STRENGTHENED/BROADENED
 * terms against the WHOLE CV corpus regardless of section, which let a term
 * evidenced in ONE work-experience/education entry wrongly justify a claim
 * about a DIFFERENT entry — e.g. "Docker" listed only in Skills (or used
 * only at a different job) does not prove it was used at Toyota; "conferences"
 * attested for Role A does not prove Role B involved them. Evidence scope is
 * now section-aware:
 *   - summary:      whole-CV corpus — a summary legitimately aggregates the
 *                    entire CV, so cross-referencing anywhere is fair.
 *   - workExperience/education: scoped to the SPECIFIC entry the suggestion
 *                    targets (see resolveEntryCorpus) — resolved via the
 *                    exact bullet-text match TailoringService.applyDecisions()
 *                    already relies on to know which bullet to replace, or
 *                    the "Company | Title" / "Institution | Degree" `field`
 *                    identifier documented in the tailoring prompt's schema.
 *                    If neither reliably identifies an entry, falls back to
 *                    just `originalContent` itself — never the rest of the
 *                    CV — so an unresolvable suggestion is graded
 *                    conservatively rather than permissively.
 *   - skills/languages/certifications: unchanged — these are honest,
 *                    general claims ("I know X"), not claims about a
 *                    specific job/degree, so whole-CV evidence (via the
 *                    existing isNewSkillGrounded) remains appropriate.
 *
 * V2.1 also extends the workExperience/education BROADENED check with a
 * KNOWN_TECH_TERMS list (Docker, Kubernetes, AWS, ...) — V2 only caught the
 * curated SCOPE_BROADENING_TERMS (conferences, graduate, ...), which never
 * included plain technology names, so a Skills-only "Docker" attributed to
 * a specific job went completely unchecked.
 *
 * `reason` (the model's stated justification, never applied to the CV — see
 * TailoringService.applyDecisions, which only ever writes suggestedContent/
 * editedContent) is handled separately: an unsupported claim in `reason`
 * does not reject an otherwise-safe suggestion, since that would discard a
 * genuinely useful CV change over metadata that can never reach the CV
 * itself. Instead the reason is replaced with a generic, safe explanation
 * — see sanitizeReason.
 *
 * Like possession-claim-guard.util.ts (Cover Letter) and
 * recommendation-grounding.util.ts (Analysis), this is a small, bounded,
 * deterministic term-list/whole-phrase check — never a general NLP/semantic
 * system. It cannot catch every conceivable fabrication, but it directly
 * covers every pattern found in production regression testing, and — same
 * philosophy as the rest of the codebase — stays conservative: a
 * suggestion is only rejected when it names a specific curated risk term
 * that is genuinely absent from the relevant evidence scope, never on vague
 * suspicion.
 */

export type EvidenceLevel =
  | 'EXACT'
  | 'PARAPHRASE'
  | 'REORDER'
  | 'EMPHASIS'
  | 'UNSUPPORTED'
  | 'STRENGTHENED'
  | 'BROADENED';

export interface GroundingVerdict {
  level: EvidenceLevel;
  allowed: boolean;
  /** Present only when the suggestion is allowed but its `reason` named an
   *  unsupported claim — reason text is never applied to the CV, but it IS
   *  shown to the user, so a fabricated justification must not reach them
   *  even when the underlying content change is safe. Callers should
   *  replace the suggestion's `reason` with this text before persisting. */
  sanitizedReason?: string;
}

const SAFE_FALLBACK_REASON = 'Improves alignment with the job description.';

// Intensity words that exaggerate an existing fact rather than merely
// restating it — safe only if the relevant evidence scope already supports
// that intensity level (candidate already describes themselves this way
// for the same job/degree, or anywhere for a summary), never as a
// first-time escalation invented by the model.
const INTENSITY_ESCALATION_TERMS: readonly string[] = [
  'extensive',
  'strong background',
  'highly experienced',
  'expert',
  'expert-level',
  'proficient',
  'highly skilled',
  'exceptional',
  'outstanding',
  'seasoned',
  'deep expertise',
  'advanced',
];

// Soft skills / team methodologies that are trivial to fabricate and never
// inferable from unrelated technical work — same category as Cover Letter's
// SOFT_SKILL_TERMS (possession-claim-guard.util.ts), extended with the
// tailoring-specific terms named in production QA (mentoring, cloud
// experience).
const SOFT_SKILL_METHODOLOGY_TERMS: readonly string[] = [
  'teamwork',
  'team player',
  'agile',
  'scrum',
  'leadership',
  'mentoring',
  'mentorship',
  'cloud experience',
  'cross-functional',
  'stakeholder management',
  'collaboration',
  'collaborative',
  'attention to detail',
  'problem-solving',
  'problem solving',
];

// Concrete scope-broadening terms from production regression testing — a
// suggestion naming one of these is expanding into a materially different
// (usually more impressive-sounding) concept than what the evidence scope
// supports.
const SCOPE_BROADENING_TERMS: readonly string[] = [
  'corporate event',
  'corporate events',
  'conference',
  'conferences',
  'vip function',
  'vip functions',
  'authentication system',
  'authentication systems',
  'system monitoring',
  'monitoring',
  'graduate',
  'graduate degree',
  'postgraduate',
  "master's degree",
  'masters degree',
  'phd',
  'doctorate',
];

// Plain technology names — a term from this list attributed to a SPECIFIC
// work-experience/education entry must be evidenced in THAT entry, not
// merely present somewhere else in the CV (e.g. the Skills list, or a
// different job). Deliberately a fixed, curated list — same bounded,
// deterministic approach as Cover Letter's KNOWN_TECH_TERMS
// (possession-claim-guard.util.ts) — not an attempt at exhaustive coverage.
const KNOWN_TECH_TERMS: readonly string[] = [
  'docker',
  'kubernetes',
  'python',
  'java',
  'javascript',
  'typescript',
  'aws',
  'azure',
  'gcp',
  'google cloud',
  'rest api',
  'rest apis',
  'graphql',
  'sql',
  'mysql',
  'postgresql',
  'postgres',
  'mongodb',
  'terraform',
  'ansible',
  'git',
  'github',
  'ci/cd',
  'ci cd',
  'linux',
  'react',
  'angular',
  'vue',
  'node.js',
  'nodejs',
  'jenkins',
  'redis',
  'kafka',
];

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Whole-word/whole-phrase containment — "graduate" must not match inside
 *  "undergraduate", "git" must not match inside "digit", etc. */
function containsWholePhrase(haystack: string, phrase: string): boolean {
  const normHaystack = normalize(haystack);
  const normPhrase = normalize(phrase);
  if (!normPhrase) return false;
  const escaped = normPhrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|\\s)${escaped}($|\\s)`).test(normHaystack);
}

function wordMultiset(text: string): string[] {
  return normalize(text).split(' ').filter(Boolean).sort();
}

/** True if `a` and `b` contain exactly the same words, only reordered. */
function isSameWordsReordered(a: string, b: string): boolean {
  const wa = wordMultiset(a);
  const wb = wordMultiset(b);
  if (wa.length === 0 || wa.length !== wb.length) return false;
  return wa.every((word, i) => word === wb[i]);
}

/** Flattens every text-bearing field of the CV into one searchable corpus.
 *  Mirrors skill-grounding.util.ts's buildCvGroundingCorpus — kept as a
 *  separate copy rather than a shared import so the two modules' grounding
 *  rules can evolve independently without coupling on an internal helper. */
function buildFullCorpus(content: CvContent): string {
  const parts: string[] = [];

  if (content.personalDetails.jobTitle) parts.push(content.personalDetails.jobTitle);
  if (content.summary) parts.push(content.summary);

  for (const e of content.workExperience) parts.push(e.title, e.company, ...e.bullets);
  for (const e of content.education) {
    parts.push(e.degree, e.institution);
    if (e.field) parts.push(e.field);
  }
  for (const s of content.skills) parts.push(s.name);
  for (const l of content.languages) parts.push(l.name);
  for (const c of content.certifications) {
    parts.push(c.name);
    if (c.issuer) parts.push(c.issuer);
  }

  return parts.filter(Boolean).join('\n');
}

function workEntryCorpus(entry: CvWorkEntry): string {
  return [entry.title, entry.company, ...entry.bullets].join('\n');
}

function educationEntryCorpus(entry: CvEducationEntry): string {
  const parts = [entry.degree, entry.institution];
  if (entry.field) parts.push(entry.field);
  return parts.join('\n');
}

/** Splits a "Company | Title" or "Institution | Degree" field identifier
 *  into its two parts, trimmed. Returns undefined pieces are tolerated by
 *  callers (an absent second half still allows a primary-key-only match). */
function splitField(field: string | null | undefined): [string, string | undefined] | undefined {
  if (!field) return undefined;
  const [a, b] = field.split('|').map((part) => part.trim());
  if (!a) return undefined;
  return [a, b || undefined];
}

/**
 * Resolves the evidence scope for a workExperience/education suggestion —
 * the SPECIFIC entry it targets, never the whole CV (see the module header
 * for why: a term evidenced in a different job/degree must not ground a
 * claim about this one). Two resolution strategies, tried in order:
 *
 *  1. Exact bullet-text match on `originalContent` — the same mechanism
 *     TailoringService.applyDecisions() already relies on to know which
 *     bullet to replace when a suggestion is applied (workExperience only;
 *     education entries have no bullets array to match against).
 *  2. The "Company | Title" / "Institution | Degree" `field` identifier
 *     documented in the tailoring prompt's schema.
 *
 * Falls back to `originalContent` alone — never the rest of the CV — when
 * neither strategy identifies an entry, so an unresolvable suggestion is
 * graded conservatively rather than permissively.
 */
function resolveEntryCorpus(suggestion: GroundableSuggestion, content: CvContent): string {
  if (suggestion.section === 'workExperience') {
    let entry = suggestion.originalContent
      ? content.workExperience.find((e) => e.bullets.includes(suggestion.originalContent))
      : undefined;

    if (!entry) {
      const field = splitField(suggestion.field);
      if (field) {
        const [company, title] = field;
        entry = content.workExperience.find(
          (e) => e.company === company && (!title || e.title === title),
        );
      }
    }

    if (entry) return workEntryCorpus(entry);
  }

  if (suggestion.section === 'education') {
    const field = splitField(suggestion.field);
    if (field) {
      const [institution, degree] = field;
      const entry = content.education.find(
        (e) => e.institution === institution && (!degree || e.degree === degree),
      );
      if (entry) return educationEntryCorpus(entry);
    }
  }

  return suggestion.originalContent ?? '';
}

type GroundableSuggestion = Pick<
  TailoringSuggestion,
  'section' | 'field' | 'originalContent' | 'suggestedContent' | 'evidence' | 'reason'
>;

/** Replaces `reason` with a safe generic fallback if it names a soft-skill/
 *  methodology term not evidenced anywhere in the CV — checked against the
 *  whole-CV corpus regardless of section, since `reason` is explanatory
 *  metadata (never applied to the CV) rather than the factual claim itself;
 *  narrower scoping here would add complexity without a matching safety
 *  need. Returns undefined when `reason` is already safe. */
function sanitizeReason(reason: string | undefined, fullCorpus: string): string | undefined {
  if (!reason) return undefined;
  for (const term of SOFT_SKILL_METHODOLOGY_TERMS) {
    if (containsWholePhrase(reason, term) && !containsWholePhrase(fullCorpus, term)) {
      return SAFE_FALLBACK_REASON;
    }
  }
  return undefined;
}

function allow(
  level: EvidenceLevel,
  suggestion: GroundableSuggestion,
  fullCorpus: string,
): GroundingVerdict {
  const sanitizedReason = sanitizeReason(suggestion.reason, fullCorpus);
  return sanitizedReason ? { level, allowed: true, sanitizedReason } : { level, allowed: true };
}

/**
 * Classifies a single tailoring suggestion's evidence level against the
 * candidate's master CvContent and returns whether it should be allowed
 * through to the user (and, if allowed, whether its `reason` needs
 * sanitizing before being persisted/shown).
 */
export function classifySuggestionGrounding(
  suggestion: GroundableSuggestion,
  content: CvContent,
): GroundingVerdict {
  const fullCorpus = buildFullCorpus(content);

  // Skills/languages additions — delegate to the existing, already-tested
  // evidence-quote-based grounding check (skill-grounding.util.ts). These
  // are general "I know X" claims, not claims about a specific job/degree,
  // so whole-CV evidence remains appropriate here (unchanged from V2).
  if (
    (suggestion.section === 'skills' || suggestion.section === 'languages') &&
    !suggestion.originalContent
  ) {
    if (!isNewSkillGrounded(suggestion.suggestedContent, suggestion.evidence, content)) {
      return { level: 'UNSUPPORTED', allowed: false };
    }
    for (const term of SCOPE_BROADENING_TERMS) {
      if (
        containsWholePhrase(suggestion.suggestedContent, term) &&
        !containsWholePhrase(fullCorpus, term)
      ) {
        return { level: 'BROADENED', allowed: false };
      }
    }
    return allow('PARAPHRASE', suggestion, fullCorpus);
  }

  // Certification additions — a fabricated certification is just as easy
  // to invent as a fabricated skill, and just as damaging if applied to a
  // real CV, so it gets the same evidence-quote requirement (unchanged).
  if (suggestion.section === 'certifications' && !suggestion.originalContent) {
    const grounded = isNewSkillGrounded(suggestion.suggestedContent, suggestion.evidence, content);
    return grounded
      ? allow('PARAPHRASE', suggestion, fullCorpus)
      : { level: 'UNSUPPORTED', allowed: false };
  }

  // summary / workExperience / education (and any other free-text edit):
  // compare the proposed replacement against the exact original text,
  // using the evidence scope appropriate to the section (see module header
  // and resolveEntryCorpus).
  const original = suggestion.originalContent ?? '';
  const proposed = suggestion.suggestedContent;
  const contentCorpus =
    suggestion.section === 'summary' ? fullCorpus : resolveEntryCorpus(suggestion, content);

  if (proposed.trim() === original.trim()) {
    return allow('EXACT', suggestion, fullCorpus);
  }
  if (original && isSameWordsReordered(original, proposed)) {
    return allow('REORDER', suggestion, fullCorpus);
  }

  for (const term of INTENSITY_ESCALATION_TERMS) {
    if (containsWholePhrase(proposed, term) && !containsWholePhrase(contentCorpus, term)) {
      return { level: 'STRENGTHENED', allowed: false };
    }
  }

  const broadeningTerms =
    suggestion.section === 'workExperience' || suggestion.section === 'education'
      ? [...SCOPE_BROADENING_TERMS, ...KNOWN_TECH_TERMS]
      : SCOPE_BROADENING_TERMS;
  for (const term of broadeningTerms) {
    if (containsWholePhrase(proposed, term) && !containsWholePhrase(contentCorpus, term)) {
      return { level: 'BROADENED', allowed: false };
    }
  }

  for (const term of SOFT_SKILL_METHODOLOGY_TERMS) {
    if (containsWholePhrase(proposed, term) && !containsWholePhrase(contentCorpus, term)) {
      return { level: 'UNSUPPORTED', allowed: false };
    }
  }

  return allow(original ? 'PARAPHRASE' : 'EMPHASIS', suggestion, fullCorpus);
}
