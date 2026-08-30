/**
 * Conservative, narrow-scope deterministic guard against the specific
 * hallucination pattern discovered in manual regression testing: a cover
 * letter asserting the candidate currently POSSESSES a technology/skill that
 * never appears anywhere in their CV, phrased as a factual claim rather than
 * genuine aspiration — e.g. "I am proficient in Python" vs "I am interested
 * in learning Python." Both mention Python; only the first is a fabrication.
 *
 * This deliberately does NOT attempt general free-form factual verification
 * (that is a semantic-entailment problem regex cannot solve reliably — see
 * the investigation report). It only flags a sentence when BOTH:
 *   1. it names a known technology/skill term absent from the CV, AND
 *   2. it matches a well-known "I currently have/know this" phrasing pattern,
 * and it NEVER flags a sentence that also matches a clear non-claim
 * (aspirational, learning-interest, or negated/disclaiming) phrasing pattern
 * — that override always wins. Anything more ambiguous than that (no clear
 * possession pattern either way) is intentionally left unflagged, trusting
 * the strengthened system prompt rather than risking a brittle heuristic
 * that damages honest, naturally-written text.
 */

const KNOWN_TECH_TERMS: readonly string[] = [
  'python',
  'java',
  'typescript',
  'javascript',
  'rest api',
  'rest apis',
  'restful',
  'postgresql',
  'postgres',
  'mysql',
  'sql',
  'git',
  'github',
  'docker',
  'kubernetes',
  'ci/cd',
  'ci cd',
  'continuous integration',
  'continuous deployment',
  'aws',
  'azure',
  'gcp',
  'google cloud',
  'cloud platform',
  'cloud platforms',
  'cloud computing',
  'scalable system',
  'scalable systems',
  'scalability',
  'database query optimization',
  'query optimization',
  'database optimization',
];

// Sentence matches ANY of these → treated as a genuine "I currently have/know
// this" claim, PROVIDED no override pattern below also matches.
const POSSESSION_PATTERNS: readonly RegExp[] = [
  /\b(proficient|skilled|fluent|competent)\s+(in|with)\b/i,
  /\b(experienced|well[- ]versed|expert)\s+(in|with)\b/i,
  /\b(strong|solid|extensive|deep|thorough|proven|hands[- ]on|practical)\s+([a-z0-9/-]+\s+){0,3}(experience|expertise|knowledge|understanding|background|foundation)\b/i,
  /\b(have|has|had)\s+([a-z0-9-]+\s+){0,3}experience\b/i,
  /\bexpertise\s+(in|with)\b/i,
  /\bbackground\s+in\b/i,
];

// Sentence matches ANY of these → never flagged, regardless of tech terms or
// possession patterns also present. Covers aspirational/learning-interest
// framing and explicit negation/disclaimer framing.
const NON_CLAIM_OVERRIDE_PATTERNS: readonly RegExp[] = [
  /\b(interested in|keen to|eager to|excited to|hope to|hoping to|looking to|aim to|would love to|would welcome the opportunity to|look forward to)\b/i,
  /\b(develop|expand|build|grow|strengthen|deepen)(ing)?\s+(my\s+)?(knowledge|skills?|experience|understanding)\b/i,
  /\bnew to\b/i,
  /\bstill learning\b/i,
  /\b(haven'?t|hasn'?t|have not|has not|don'?t have|do not have|without|lack(ing)?)\b/i,
];

function splitIntoSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Whole-word/whole-phrase containment — "git" must not match inside
 *  "digit" or "legitimate", "sql" must not match inside "sequel", etc. */
function containsWholePhrase(haystack: string, phrase: string): boolean {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z0-9])${escaped}($|[^a-z0-9])`, 'i').test(haystack);
}

/**
 * Returns a human-readable description of each unsupported possession claim
 * found in `letterText`, checked against `cvEvidenceText` (the CV text and,
 * when available, the candidate's listed skills — never the job
 * description). An empty array means no violation was found.
 */
export function findUnsupportedPossessionClaims(
  letterText: string,
  cvEvidenceText: string,
): string[] {
  const violations: string[] = [];

  for (const sentence of splitIntoSentences(letterText)) {
    if (NON_CLAIM_OVERRIDE_PATTERNS.some((p) => p.test(sentence))) continue;

    const hasPossessionPattern = POSSESSION_PATTERNS.some((p) => p.test(sentence));
    if (!hasPossessionPattern) continue;

    for (const term of KNOWN_TECH_TERMS) {
      if (containsWholePhrase(sentence, term) && !containsWholePhrase(cvEvidenceText, term)) {
        violations.push(`"${term}" in: "${sentence}"`);
      }
    }
  }

  return violations;
}
