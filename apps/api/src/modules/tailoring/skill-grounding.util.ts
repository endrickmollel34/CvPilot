import type { CvContent } from '@cvpilot/shared';

/**
 * Deterministic, non-LLM grounding check for tailoring suggestions that add a
 * new skill/language (section: 'skills' | 'languages', originalContent: '').
 *
 * Why this exists: the AI prompt asks the model to justify new skill/language
 * suggestions with a quote from the CV, but prompts are not enforcement — a
 * model can still ignore the instruction and fabricate a skill straight from
 * the job description. This module re-verifies the model's claim against the
 * actual CvContent server-side, so a suggestion only survives if it is
 * genuinely backed by the candidate's own CV — never by the job description
 * (this module never even sees the job description; it only takes CvContent).
 *
 * Used in two places (belt and suspenders):
 *  - TailoringService.runTailoring() — filters ungrounded suggestions out
 *    before they are ever persisted/shown to the user.
 *  - TailoringService.applyDecisions() — re-checks at apply time, so a
 *    suggestion that was somehow stored ungrounded (e.g. persisted before
 *    this check existed) still cannot be written into a tailored CV.
 */

/** Common tech-term spelling/phrasing variants folded to one canonical form
 *  before comparison, so safe normalizations (e.g. "RESTful services" →
 *  "REST APIs") are recognised without treating unrelated terms as matches. */
const TECH_ALIAS_PATTERNS: ReadonlyArray<[RegExp, string]> = [
  [/\brestful\s*(web\s*)?(api|apis|service|services)?\b/g, 'rest api'],
  [/\brest\s*(api|apis)\b/g, 'rest api'],
  [/\bpostgres(ql)?\b/g, 'postgresql'],
  [/\bmongo(db)?\b/g, 'mongodb'],
  [/\bk8s\b/g, 'kubernetes'],
  [/\bjavascript\b/g, 'javascript'],
  [/\bnode(\.?js)?\b/g, 'nodejs'],
  [/\btypescript\b/g, 'typescript'],
  [/\bci\s*\/\s*cd\b/g, 'ci cd'],
];

function normalize(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => (token.length > 3 && token.endsWith('s') ? token.slice(0, -1) : token))
    .join(' ')
    .trim();
}

function canonicalizeTech(input: string): string {
  let out = normalize(input);
  for (const [pattern, replacement] of TECH_ALIAS_PATTERNS) {
    out = out.replace(pattern, replacement);
  }
  return normalize(out);
}

/** True if `phrase` appears in `haystack` on whole-word boundaries — not as a
 *  loose substring. This deliberately rejects lookalikes like "Java" merely
 *  because "JavaScript" appears in the text, or "Git" because "GitHub" does;
 *  those are exactly the ambiguous cases we want to stay conservative about. */
function containsWholePhrase(haystack: string, phrase: string): boolean {
  if (!phrase) return false;
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|\\s)${escaped}($|\\s)`).test(haystack);
}

function isTechnologyMatch(skillName: string, evidence: string): boolean {
  const canonName = canonicalizeTech(skillName);
  const canonEvidence = canonicalizeTech(evidence);
  if (!canonName) return false;

  if (containsWholePhrase(canonEvidence, canonName)) return true;

  // Fallback: every significant word in the skill name must independently
  // appear as a whole word somewhere in the evidence. Still conservative —
  // a single missing core word fails the match.
  const nameTokens = canonName.split(' ').filter((t) => t.length >= 3);
  if (nameTokens.length === 0) return false;
  return nameTokens.every((t) => containsWholePhrase(canonEvidence, t));
}

/** Flattens every text-bearing field of the CV into one searchable corpus.
 *  Never includes the job description — only the candidate's own CV. */
function buildCvGroundingCorpus(content: CvContent): string {
  const parts: string[] = [];

  if (content.personalDetails.jobTitle) parts.push(content.personalDetails.jobTitle);
  if (content.summary) parts.push(content.summary);

  for (const e of content.workExperience) {
    parts.push(e.title, e.company, ...e.bullets);
  }
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

/**
 * Returns true only if adding `skillName` to the CV's skills/languages is
 * justified:
 *  - it already exists there (not really a new addition), or
 *  - `evidence` is both (a) genuinely found in the CV, and (b) actually about
 *    `skillName` (not an unrelated quote paired with an unrelated skill).
 *
 * Ambiguous or missing evidence returns false — conservative by design.
 */
export function isNewSkillGrounded(
  skillName: string,
  evidence: string | undefined | null,
  content: CvContent,
): boolean {
  const targetNorm = normalize(skillName);
  const alreadyPresent = [...content.skills, ...content.languages].some(
    (existing) => normalize(existing.name) === targetNorm,
  );
  if (alreadyPresent) return true;

  if (!evidence?.trim()) return false;

  const corpus = normalize(buildCvGroundingCorpus(content));
  const evidenceNorm = normalize(evidence);
  if (!evidenceNorm || !corpus.includes(evidenceNorm)) return false;

  return isTechnologyMatch(skillName, evidence);
}
