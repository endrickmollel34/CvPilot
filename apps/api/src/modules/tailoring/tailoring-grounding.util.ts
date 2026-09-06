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
 * V2.2 (factual identity field protection): none of the checks above catch
 * an AI-generated "Company | Job Title" suggestion that silently renames
 * the employer-issued job title itself (e.g. "Junior Developer" →
 * "Backend Developer" to better match a target job description) — job
 * titles, company names, and dates aren't a fixed vocabulary the way
 * "conferences" or "Docker" are, so no curated term list can catch an
 * arbitrary swap. A new IDENTITY_CHANGED level (see
 * identityFieldsPreserved) independently protects each resolved entry's
 * factual identity fields — job title/company/dates for workExperience,
 * degree/institution/dates for education — regardless of what the
 * "reason" claims about relevance to the target role. Content-transforming
 * checks (STRENGTHENED/BROADENED/etc.) remain about bullet WORDING; this
 * is about entry IDENTITY, checked first.
 *
 * V2.3 (exact normalized identity comparison): V2.2's identityFieldsPreserved
 * asked "does the OLD value still appear as a whole phrase ANYWHERE in the
 * new text?" — which incorrectly PASSED suggestions like "Engineer" ->
 * "Senior Backend Engineer", "Acme" -> "Acme Corporation International", or
 * "Computer Science" -> "Advanced Computer Science", because the short old
 * value is still a whole word inside the longer new phrase, even though the
 * identity itself changed. This is now replaced with schema-aware
 * extraction: workExperience/education suggestions render as known
 * composite display strings (see serializeCvContent in
 * tailoring-ai.service.ts — "TITLE at COMPANY (LOCATION) [DATES]" / "DEGREE
 * in FIELD at INSTITUTION"), so extractWorkIdentityFields /
 * extractEducationIdentityFields parse suggestedContent's title/company (or
 * degree/field/institution) slot using that same schema — tolerating
 * harmless reformatting (comma-separated instead of "at", "to" instead of
 * "–", reordered punctuation) — and the EXTRACTED value at each slot is
 * compared for exact normalized equality against the resolved entry's real
 * value from resolveWorkEntry/resolveEducationEntry, never mere substring
 * containment. Employment/education dates are checked separately via bare
 * YYYY-MM token extraction, which was already exact-value-based (not
 * substring-vulnerable) and needed no change. A composite line whose
 * structure is no longer recognizable at all fails closed (rejected) rather
 * than falling back to the old permissive check — see
 * workIdentityPreserved/educationIdentityPreserved.
 *
 * V2.4 (entry resolution robustness + fail-closed on unresolved identity):
 * URGENT production regression — the exact Toyota "Junior Developer" ->
 * "Backend Developer" rename this whole protection exists for STILL reached
 * the UI after V2.3. Root cause: resolveWorkEntry could only identify the
 * targeted entry via an exact bullet-text match (identity-line suggestions
 * never match a bullet) or the `field` identifier — and `field` is not
 * reliably populated by the model despite the prompt asking for it. With no
 * entry resolved, classifySuggestionGrounding's `if (entry && ...)` guard
 * silently SKIPPED the identity check entirely rather than rejecting —
 * V2.3's comparison logic was never even reached. Two changes close this:
 *   1. resolveWorkEntry gained a third resolution strategy — parsing
 *      `originalContent` itself (via extractWorkIdentityFields) to recover
 *      the CURRENT title/company directly, independent of `field`. This is
 *      authoritative regardless of whether `field` is missing, malformed,
 *      or reversed in order, and both resolveWorkEntry/resolveEducationEntry's
 *      `field`-based matching is now case/whitespace-normalized too.
 *   2. If an entry STILL can't be resolved by any strategy, the suggestion
 *      now fails closed (rejected as IDENTITY_CHANGED) whenever it is
 *      clearly identity-directed rather than an ordinary bullet/wording
 *      change — see the fail-closed comment at the call site in
 *      classifySuggestionGrounding for the exact, narrow signal used for
 *      each section (a YYYY-MM date token for workExperience; an explicit
 *      but unresolvable `field` for education) so ordinary suggestions that
 *      simply couldn't be matched to a specific entry are never punished.
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
  | 'BROADENED'
  | 'IDENTITY_CHANGED';

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
 * Resolves the SPECIFIC work-experience entry a suggestion targets. Three
 * strategies, tried in order:
 *
 *  1. Exact bullet-text match on `originalContent` — the same mechanism
 *     TailoringService.applyDecisions() already relies on to know which
 *     bullet to replace when a suggestion is applied.
 *  2. The "Company | Title" `field` identifier documented in the tailoring
 *     prompt's schema (case/whitespace-normalized).
 *  3. V2.4 — the identity line's OWN extracted title/company (via
 *     extractWorkIdentityFields), independent of `field`. Production
 *     regression testing found the exact Toyota "Junior Developer" ->
 *     "Backend Developer" rename STILL reaching the UI after V2.3, because
 *     `field` is not reliably populated by the model (missing/null, or
 *     otherwise malformed) even though the prompt asks for it — and with no
 *     `field` to key off, strategies 1-2 both failed, so `entry` came back
 *     undefined and the IDENTITY_CHANGED check in classifySuggestionGrounding
 *     was silently skipped (see its `if (entry && ...)` guard) rather than
 *     rejecting the suggestion. `originalContent` is the CV's own current
 *     composite line — parsing it directly to recover title/company is
 *     authoritative and does not depend on `field` at all, so this closes
 *     that gap regardless of whether `field` is missing, malformed, or even
 *     accidentally reversed in order.
 */
function resolveWorkEntry(
  suggestion: GroundableSuggestion,
  content: CvContent,
): CvWorkEntry | undefined {
  let entry = suggestion.originalContent
    ? content.workExperience.find((e) => e.bullets.includes(suggestion.originalContent))
    : undefined;

  if (!entry) {
    const field = splitField(suggestion.field);
    if (field) {
      const [company, title] = field;
      entry = content.workExperience.find(
        (e) =>
          normalize(e.company) === normalize(company) &&
          (!title || normalize(e.title) === normalize(title)),
      );
    }
  }

  if (!entry && suggestion.originalContent) {
    const parsed = extractWorkIdentityFields(suggestion.originalContent);
    if (parsed) {
      entry = content.workExperience.find(
        (e) =>
          normalize(e.title) === normalize(parsed.title) &&
          normalize(e.company) === normalize(parsed.company),
      );
    }
  }

  return entry;
}

/** Resolves the SPECIFIC education entry a suggestion targets, via the
 *  "Institution | Degree" `field` identifier (case/whitespace-normalized) —
 *  education entries have no bullets array to exact-match against, so
 *  `field` is the only resolution strategy. (Unlike resolveWorkEntry, this
 *  deliberately does NOT add a content-based parsing fallback — education's
 *  composite line legitimately overlaps in shape with e.g. a BROADENED
 *  scope-change suggestion that isn't identity-related at all, and adding
 *  that fallback here would misclassify such cases as unresolvable-identity
 *  instead of letting the existing term-list checks correctly label them.
 *  See classifySuggestionGrounding's narrower education fail-closed check,
 *  which instead triggers only when `field` was explicitly provided but
 *  still didn't resolve.) */
function resolveEducationEntry(
  suggestion: GroundableSuggestion,
  content: CvContent,
): CvEducationEntry | undefined {
  const field = splitField(suggestion.field);
  if (!field) return undefined;
  const [institution, degree] = field;
  return content.education.find(
    (e) =>
      normalize(e.institution) === normalize(institution) &&
      (!degree || normalize(e.degree) === normalize(degree)),
  );
}

/**
 * Resolves the evidence scope for a workExperience/education suggestion —
 * the SPECIFIC entry it targets, never the whole CV (see the module header
 * for why: a term evidenced in a different job/degree must not ground a
 * claim about this one). Falls back to `originalContent` alone — never the
 * rest of the CV — when the entry cannot be resolved, so an unresolvable
 * suggestion is graded conservatively rather than permissively.
 */
function resolveEntryCorpus(suggestion: GroundableSuggestion, content: CvContent): string {
  if (suggestion.section === 'workExperience') {
    const entry = resolveWorkEntry(suggestion, content);
    if (entry) return workEntryCorpus(entry);
  }

  if (suggestion.section === 'education') {
    const entry = resolveEducationEntry(suggestion, content);
    if (entry) return educationEntryCorpus(entry);
  }

  return suggestion.originalContent ?? '';
}

/** Bare YYYY-MM date tokens present anywhere in `text`, in order. Dates are
 *  unambiguous numeric tokens with no "expansion" risk the way titles have,
 *  so exact-token extraction (not phrase parsing) is sufficient here. */
function extractDateTokens(text: string): string[] {
  return text.match(/\d{4}-\d{2}/g) ?? [];
}

/**
 * Parses the composite work-experience identity line ("TITLE at COMPANY
 * (LOCATION) [DATES]", per serializeCvContent in tailoring-ai.service.ts)
 * into its title/company slots, tolerating harmless reformatting (comma-
 * separated instead of "at", "to" instead of "–", reordered date range,
 * missing brackets, etc). Returns undefined when no recognizable
 * title/company structure is found, so callers fail closed rather than
 * guess.
 */
function extractWorkIdentityFields(text: string): { title: string; company: string } | undefined {
  const cleaned = text
    // Bracketed date range, e.g. "[2024-11 – 2025-09]".
    .replace(/\[[^\]]*\]/g, ' ')
    // Bare date range/single date, with any connector, e.g.
    // "2024-11 to 2025-09" or "2024-11 – 2025-09".
    .replace(/\d{4}-\d{2}(\s*(?:–|-|to)\s*\d{4}-\d{2})?/gi, ' ')
    .replace(/\bpresent\b/gi, ' ')
    // First parenthetical — location, e.g. "(Dar es Salaam)".
    .replace(/\([^)]*\)/, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\s*,\s*/g, ', ')
    .trim()
    .replace(/^,\s*/, '')
    .replace(/,\s*$/, '');

  const atParts = cleaned.split(/\s+at\s+/i);
  if (atParts.length >= 2 && atParts[0] && atParts[1]) {
    return { title: atParts[0].trim(), company: atParts.slice(1).join(' at ').trim() };
  }

  const commaParts = cleaned
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  if (commaParts.length >= 2) {
    return { title: commaParts[0]!, company: commaParts[1]! };
  }

  return undefined;
}

/**
 * Parses the composite education identity line ("DEGREE in FIELD at
 * INSTITUTION", per serializeCvContent) into its slots. Deliberately does
 * NOT touch parentheses — unlike work-experience location, a degree value
 * can itself legitimately contain parentheses (e.g. "Bachelor of Science
 * (In Progress)"), so stripping them would corrupt the degree rather than
 * isolate a wrapper.
 */
function extractEducationIdentityFields(
  text: string,
): { degree: string; field?: string; institution: string } | undefined {
  const atIdx = text.toLowerCase().lastIndexOf(' at ');
  let before: string;
  let institution: string;

  if (atIdx !== -1) {
    before = text.slice(0, atIdx).trim();
    institution = text.slice(atIdx + 4).trim();
  } else {
    // Harmless reformatting fallback, e.g. "DEGREE in FIELD, INSTITUTION"
    // instead of "... at INSTITUTION" — same tolerance as
    // extractWorkIdentityFields' comma fallback.
    const commaParts = text
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean);
    if (commaParts.length < 2) return undefined;
    institution = commaParts[commaParts.length - 1]!;
    before = commaParts.slice(0, -1).join(', ');
  }
  if (!before || !institution) return undefined;

  const inMatch = /^(.*?)\s+in\s+(.+)$/i.exec(before);
  if (inMatch) {
    return { degree: inMatch[1]!.trim(), field: inMatch[2]!.trim(), institution };
  }
  return { degree: before, institution };
}

/**
 * V2.2/V2.3 — factual identity field protection. Production QA found a
 * "Company | Job Title" suggestion silently renaming "Junior Developer" to
 * "Backend Developer" to better match a target job description. No curated
 * term list can catch an arbitrary job-title swap the way it catches
 * "conferences" or "Docker" — job titles aren't a fixed vocabulary. An
 * employer-issued job title, company name, and employment dates are
 * factual employment history — none of these are AI tailoring's to
 * rewrite, no matter how well-intentioned the reason given. (This does not
 * restrict the USER from manually editing their own CV afterwards — it
 * only bounds what AI-GENERATED suggestions may change.)
 *
 * For each protected field: if the field's CURRENT value appears in
 * `originalContent` (i.e. this suggestion is even talking about that
 * field), the value EXTRACTED from the same slot in `suggestedContent`
 * (via extractWorkIdentityFields — see module header for why this replaced
 * a plain substring check) must be exactly equal, modulo normalization.
 * Dates are checked via exact token extraction instead (see
 * extractDateTokens). If the composite structure can't be parsed at all
 * but the field applies, the suggestion is rejected — never given the
 * benefit of the doubt.
 */
function workIdentityPreserved(
  originalContent: string,
  suggestedContent: string,
  entry: CvWorkEntry,
): boolean {
  for (const date of [entry.startDate, entry.endDate]) {
    if (!date || !containsWholePhrase(originalContent, date)) continue;
    if (!extractDateTokens(suggestedContent).includes(date)) return false;
  }

  const titleApplies = containsWholePhrase(originalContent, entry.title);
  const companyApplies = containsWholePhrase(originalContent, entry.company);
  if (!titleApplies && !companyApplies) return true;

  const parsed = extractWorkIdentityFields(suggestedContent);
  if (!parsed) return false;

  if (titleApplies && normalize(parsed.title) !== normalize(entry.title)) return false;
  if (companyApplies && normalize(parsed.company) !== normalize(entry.company)) return false;
  return true;
}

/** Education counterpart of workIdentityPreserved — see its doc comment. */
function educationIdentityPreserved(
  originalContent: string,
  suggestedContent: string,
  entry: CvEducationEntry,
): boolean {
  for (const date of [entry.startDate, entry.endDate]) {
    if (!date || !containsWholePhrase(originalContent, date)) continue;
    if (!extractDateTokens(suggestedContent).includes(date)) return false;
  }

  const degreeApplies = containsWholePhrase(originalContent, entry.degree);
  const institutionApplies = containsWholePhrase(originalContent, entry.institution);
  const fieldApplies = entry.field ? containsWholePhrase(originalContent, entry.field) : false;
  if (!degreeApplies && !institutionApplies && !fieldApplies) return true;

  const parsed = extractEducationIdentityFields(suggestedContent);
  if (!parsed) return false;

  if (degreeApplies && normalize(parsed.degree) !== normalize(entry.degree)) return false;
  if (institutionApplies && normalize(parsed.institution) !== normalize(entry.institution)) {
    return false;
  }
  if (fieldApplies && normalize(parsed.field ?? '') !== normalize(entry.field ?? '')) return false;
  return true;
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

  // Factual identity fields (job title, company, employment dates for
  // workExperience; degree, field of study, institution, education dates
  // for education) — see workIdentityPreserved/educationIdentityPreserved's
  // doc comments. Checked before the term-list-based checks below since
  // this is a structurally different, higher-priority concern (a wholesale
  // factual swap, not a risk phrase).
  //
  // V2.4 (fail-closed on unresolved identity suggestions): if `entry` can't
  // be resolved at all, the checks above previously fell through to the
  // generic term-list checks below completely unguarded — exactly what let
  // the Toyota "Junior Developer" -> "Backend Developer" rename reach
  // production after V2.3 (see resolveWorkEntry's doc comment). An
  // unresolved entry now fails closed (rejected) IF the suggestion is
  // clearly identity-directed, without punishing ordinary bullets that
  // simply couldn't be matched to a specific job/degree:
  //   - workExperience: originalContent carries a YYYY-MM date token, which
  //     only ever appears in the rendered "TITLE at COMPANY (LOCATION)
  //     [DATES]" identity line (see serializeCvContent) — an ordinary
  //     bullet essentially never contains one, so this is a safe signal.
  //   - education: `field` was explicitly provided (the suggestion names a
  //     specific institution/degree) but still didn't resolve to a real
  //     entry — education has no bullets, but a suggestion with no `field`
  //     at all is the normal, safe shape for a scope/wording change (e.g.
  //     the "undergraduate -> graduate" BROADENED case), so that shape is
  //     deliberately left to the term-list checks below, unchanged.
  if (suggestion.section === 'workExperience') {
    const entry = resolveWorkEntry(suggestion, content);
    if (entry) {
      if (!workIdentityPreserved(original, proposed, entry)) {
        return { level: 'IDENTITY_CHANGED', allowed: false };
      }
    } else if (extractDateTokens(original).length > 0) {
      return { level: 'IDENTITY_CHANGED', allowed: false };
    }
  }
  if (suggestion.section === 'education') {
    const entry = resolveEducationEntry(suggestion, content);
    if (entry) {
      if (!educationIdentityPreserved(original, proposed, entry)) {
        return { level: 'IDENTITY_CHANGED', allowed: false };
      }
    } else if (splitField(suggestion.field)) {
      return { level: 'IDENTITY_CHANGED', allowed: false };
    }
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
