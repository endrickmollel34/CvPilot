import type { CvEvidence } from './cv-evidence.util';

/**
 * Conservative, narrow-scope deterministic guard against the specific
 * hallucination pattern discovered in manual regression testing: a cover
 * letter asserting the candidate currently POSSESSES a technology/skill/soft
 * skill that never appears anywhere in their CV, phrased as a factual claim
 * rather than genuine aspiration — e.g. "I am proficient in Python" vs "I am
 * interested in learning Python." Both mention Python; only the first is a
 * fabrication.
 *
 * V2 (Cover Letter Quality V2): the original version checked every claim
 * against one flat blob of "CV text + candidate skills" — which meant a term
 * that was ONLY ever listed in a skills section (never demonstrated in a
 * work bullet) was treated as fully equivalent to genuine work experience.
 * That let the model inflate "REST APIs" (a skills-list entry) into "I
 * developed scalable REST APIs at Toyota" (an unearned experience claim) —
 * production QA's exact "semantic claim inflation" finding. This version
 * checks each claim against the RIGHT evidence tier for its strength (see
 * CvEvidence in cv-evidence.util.ts):
 *   - An EXPERIENCE-strength claim ("I have experience with X", "I
 *     developed X", "X prepared me to...") must be grounded in
 *     `evidence.experienceText` specifically — a skills-list entry alone is
 *     not enough.
 *   - A KNOWLEDGE-strength claim ("I have knowledge of X", "familiar with
 *     X") is grounded by EITHER tier — a skills-list entry is genuinely
 *     sufficient for a modest knowledge claim.
 *
 * This also extends the checked-term list beyond technologies to a small
 * set of commonly-hallucinated SOFT_SKILL_TERMS (attention to detail,
 * problem-solving, teamwork, agile, leadership, communication, ...) — the
 * second production QA finding ("unsupported soft-skill/team claims"),
 * checked with the same tiered logic (e.g. "I have agile experience"
 * requires "agile" to actually appear in experienceText, not just anywhere).
 *
 * V2.1: production QA found a subtler loophole — the model stopped claiming
 * unsupported PAST experience, but started implying unsupported FUTURE
 * CAPABILITY instead, e.g. "I am eager to leverage my database design and
 * MySQL knowledge to contribute to ... implementing secure authentication
 * systems" (no CV evidence of authentication at all). The old
 * NON_CLAIM_OVERRIDE_PATTERNS exempted the *entire* sentence unconditionally
 * once it spotted an aspirational opener like "eager to" or "interested
 * in" — so a genuinely unsafe capability claim later in the same sentence
 * was never even checked. Two changes fix this:
 *   - A new CAPABILITY_CLAIM_PATTERNS category ("I can/could/am able to/am
 *     ready to contribute/implement/deliver/handle/lead/apply/build/help")
 *     — present-tense capability claims, distinct from past-tense
 *     experience claims but held to the same bar: grounded in
 *     experienceText specifically, never by a skills-list entry alone (a
 *     skill only ever supports "I'd like to develop this," never "I can
 *     deliver this").
 *   - The former NON_CLAIM_OVERRIDE_PATTERNS is split into
 *     ASPIRATIONAL_OVERRIDE_PATTERNS (soft — "interested in," "eager to,"
 *     ...) and NEGATION_OVERRIDE_PATTERNS (hard — "haven't," "without,"
 *     ...). Aspirational framing no longer exempts a sentence that ALSO
 *     matches an experience/capability claim pattern — the capability claim
 *     wins, since aspirational language can otherwise be used to smuggle in
 *     an unearned capability claim. Negation framing still always wins
 *     unconditionally — explicitly disclaiming a technology is inherently
 *     honest regardless of what else the sentence says.
 *
 * This deliberately does NOT attempt general free-form factual verification
 * (that is a semantic-entailment problem regex cannot solve reliably — see
 * the investigation report). It only flags a sentence when BOTH:
 *   1. it names a known term absent from the required evidence tier, AND
 *   2. it matches a well-known claim-strength phrasing pattern for that
 *      tier,
 * and it NEVER flags a sentence that also matches a clear non-claim
 * (aspirational, learning-interest, or negated/disclaiming) phrasing pattern
 * — that override always wins. Anything more ambiguous than that (no clear
 * claim pattern either way) is intentionally left unflagged, trusting the
 * strengthened system prompt rather than risking a brittle heuristic that
 * damages honest, naturally-written text.
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
  'database design',
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
  // Deliberately just the bare word, not "authentication system(s)" /
  // "secure authentication" as separate entries — containsWholePhrase's
  // whole-word matching already finds "authentication" inside any of those
  // longer phrases, so a CV that says "Implemented authentication using
  // OAuth" correctly grounds a claim about "authentication systems" too;
  // adding the longer phrases as their OWN separate terms would instead
  // require an exact-phrase match and wrongly reject that case.
  'authentication',
  'authorization',
];

// Commonly-hallucinated soft skills / team methodologies — never inferable
// from unrelated technical work (e.g. debugging software does not, by
// itself, establish "attention to detail" or "agile experience").
const SOFT_SKILL_TERMS: readonly string[] = [
  'attention to detail',
  'problem-solving',
  'problem solving',
  'teamwork',
  'team player',
  'cross-functional collaboration',
  'agile',
  'scrum',
  'leadership',
  'communication skills',
  'strong communication',
  'stakeholder management',
  'collaborative',
];

const ALL_CHECKED_TERMS: readonly string[] = [...KNOWN_TECH_TERMS, ...SOFT_SKILL_TERMS];

// Sentence matches ANY of these → a claim of genuinely demonstrated,
// hands-on experience — must be grounded in experienceText specifically,
// never satisfied by a skills-list entry alone.
const EXPERIENCE_CLAIM_PATTERNS: readonly RegExp[] = [
  /\b(experienced|well[- ]versed|expert)\s+(in|with)\b/i,
  /\b(strong|solid|extensive|deep|thorough|proven|hands[- ]on|practical)\s+([a-z0-9/-]+\s+){0,3}(experience|expertise|knowledge|understanding|background|foundation)\b/i,
  /\b(have|has|had)\s+([a-z0-9-]+\s+){0,3}experience\b/i,
  /\bexpertise\s+(in|with)\b/i,
  /\bbackground\s+in\b/i,
  /\b(developed|developing|develops|built|building|builds|designed|designing|designs|implemented|implementing|implements|delivered|delivering|delivers|deployed|deploying|deploys|architected|architecting|engineered|engineering|optimi[sz]ed|optimi[sz]ing|maintained|maintaining|maintains|debugged|debugging|automated|automating|configured|configuring|shipped|shipping)\b/i,
  /\b(prepared|equipped|enabled)\s+me\s+(\S+\s+){0,3}(to|for)\b/i,
  /\bresponsible for\b/i,
];

// V2.1: present-tense/future CAPABILITY claims — "I can contribute to X,"
// "I am ready to implement X." Distinct from EXPERIENCE_CLAIM_PATTERNS
// (which match past-tense/gerund evidence of having actually done
// something), but held to the same bar: a capability claim about a
// requirement is only honest if the candidate has genuinely demonstrated
// evidence for it, never a bare skills-list entry (see the module header
// comment's production QA example: "eager to leverage my ... knowledge to
// contribute to ... implementing secure authentication systems").
const CAPABILITY_CLAIM_PATTERNS: readonly RegExp[] = [
  /\b(can|could|am able to|is able to|am ready to|is ready to)\s+(\S+\s+){0,4}(contribute|implement|deliver|handle|lead|apply|build|help)\b/i,
];

// Sentence matches ANY of these (and no EXPERIENCE/CAPABILITY_CLAIM_PATTERNS)
// → a modest knowledge/familiarity claim — a skills-list entry alone is
// sufficient grounding.
const KNOWLEDGE_CLAIM_PATTERNS: readonly RegExp[] = [
  /\b(proficient|skilled|fluent|competent)\s+(in|with)\b/i,
  /\bknowledge\s+of\b/i,
  /\bfamiliar(ity)?\s+with\b/i,
  /\b(my|the)\s+(technical\s+)?skills\s+(include|encompass|comprise)\b/i,
  // "I have excellent problem-solving skills" / "I have strong X skills" — a
  // self-assessed trait/skill claim, not a claim of having done the work on
  // the job, so a skills-list entry (or an experience mention) is enough.
  /\b(have|has|had)\s+([a-z0-9-]+\s+){0,3}skills?\b/i,
];

// "Soft" override — genuinely aspirational/learning-interest framing, but
// (V2.1) it must NOT exempt a sentence that also asserts an experience or
// capability claim: aspirational language can otherwise be used to smuggle
// in an unearned capability claim later in the same sentence (see the
// module header comment).
const ASPIRATIONAL_OVERRIDE_PATTERNS: readonly RegExp[] = [
  /\b(interested in|keen to|eager to|excited to|hope to|hoping to|looking to|aim to|would love to|would welcome the opportunity to|look forward to)\b/i,
  /\b(develop|expand|build|grow|strengthen|deepen)(ing)?\s+(my\s+)?(knowledge|skills?|experience|understanding)\b/i,
  /\bnew to\b/i,
  /\bstill learning\b/i,
];

// "Hard" override — explicit negation/disclaimer framing always wins,
// regardless of anything else in the sentence: disclaiming a technology is
// inherently honest no matter what else is said.
const NEGATION_OVERRIDE_PATTERNS: readonly RegExp[] = [
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
 * found in `letterText`, checked against `evidence` — the candidate's CV
 * split into experience vs skills-only tiers (see cv-evidence.util.ts), never
 * the job description. An empty array means no violation was found.
 */
export function findUnsupportedPossessionClaims(
  letterText: string,
  evidence: CvEvidence,
): string[] {
  const violations: string[] = [];
  const fullEvidenceText = `${evidence.experienceText}\n${evidence.skillsOnlyTerms.join(', ')}`;

  for (const sentence of splitIntoSentences(letterText)) {
    // Negation always wins, unconditionally — explicitly disclaiming a
    // technology is inherently honest no matter what else the sentence says.
    if (NEGATION_OVERRIDE_PATTERNS.some((p) => p.test(sentence))) continue;

    const isExperienceClaim =
      EXPERIENCE_CLAIM_PATTERNS.some((p) => p.test(sentence)) ||
      CAPABILITY_CLAIM_PATTERNS.some((p) => p.test(sentence));

    // Aspirational framing ("eager to," "interested in," ...) only exempts
    // the sentence when it ISN'T also asserting an experience/capability
    // claim — otherwise the aspirational opener could be used to smuggle in
    // an unearned capability claim later in the same sentence (V2.1).
    if (!isExperienceClaim && ASPIRATIONAL_OVERRIDE_PATTERNS.some((p) => p.test(sentence))) {
      continue;
    }

    const isKnowledgeClaim =
      !isExperienceClaim && KNOWLEDGE_CLAIM_PATTERNS.some((p) => p.test(sentence));
    if (!isExperienceClaim && !isKnowledgeClaim) continue;

    // An experience-strength claim can only be satisfied by experienceText
    // — a knowledge-strength claim accepts either tier.
    const requiredEvidence = isExperienceClaim ? evidence.experienceText : fullEvidenceText;

    for (const term of ALL_CHECKED_TERMS) {
      if (containsWholePhrase(sentence, term) && !containsWholePhrase(requiredEvidence, term)) {
        violations.push(`"${term}" in: "${sentence}"`);
      }
    }
  }

  return violations;
}
