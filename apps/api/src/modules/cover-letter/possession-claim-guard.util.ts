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
 * V2.1.1: V2.1's tier classification was still WHOLE-SENTENCE — the moment
 * any part of a sentence matched an experience/capability pattern, EVERY
 * checked term anywhere else in that same sentence was required to be
 * experience-grounded, even a genuinely separate, honestly-phrased
 * knowledge-only mention. In production this caused a real availability
 * regression: "My familiarity with Python, Java, and REST APIs, along with
 * my knowledge of database design and MySQL, provides a strong foundation
 * for tackling the responsibilities of this role." was rejected outright,
 * because "a strong foundation" (an EXPERIENCE_CLAIM_PATTERN) appearing
 * anywhere in the sentence promoted Python/Java/REST APIs/database
 * design/MySQL — all genuinely skills-only, all honestly phrased via
 * "familiarity with"/"knowledge of" — into an experience-tier requirement
 * they could never satisfy, exhausting all 3 retries on every attempt
 * regardless of what the model actually wrote.
 *
 * The fix: claim-pattern matches are now POSITIONAL (findClaimSpans), and
 * each checked-term OCCURRENCE is graded only against its NEAREST governing
 * claim pattern (resolveGoverningTier) — preferring the nearest one that
 * precedes the term (natural English word order puts the governing phrase
 * before its object: "familiarity with Python," "can implement
 * authentication"). This is still fully deterministic/regex-based (no NLP),
 * reuses every existing pattern list unchanged, and correctly separates
 * "My knowledge of MySQL [safe knowledge claim], and I can contribute to
 * implementing authentication [unsafe capability claim]" into two
 * independently-graded claims about two different terms, even with no
 * clause-boundary punctuation between them.
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

/** All start indices of `phrase` in `text` as a whole word/phrase — same
 *  boundary rule as containsWholePhrase, but position-aware (global scan). */
function findWholePhraseIndices(text: string, phrase: string): number[] {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`(^|[^a-z0-9])(${escaped})($|[^a-z0-9])`, 'gi');
  const indices: number[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    indices.push(match.index + match[1]!.length);
    // The boundary chars around the phrase are shared with any adjacent
    // match — step back so an immediately-following occurrence isn't missed.
    regex.lastIndex = match.index + match[1]!.length + match[2]!.length;
  }
  return indices;
}

interface PatternMatch {
  index: number;
  length: number;
}

/** Every match of any of `patterns` within `text`, with position and length. */
function findAllPatternMatches(patterns: readonly RegExp[], text: string): PatternMatch[] {
  const matches: PatternMatch[] = [];
  for (const pattern of patterns) {
    const global = new RegExp(
      pattern.source,
      pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`,
    );
    let match: RegExpExecArray | null;
    while ((match = global.exec(text)) !== null) {
      matches.push({ index: match.index, length: match[0].length });
      if (match[0].length === 0) global.lastIndex++; // guard against a zero-width match looping forever
    }
  }
  return matches;
}

type ClaimTier = 'experience' | 'knowledge' | 'aspirational' | 'negation';

function isExemptTier(tier: ClaimTier): boolean {
  return tier === 'aspirational' || tier === 'negation';
}

interface ClaimSpan {
  index: number;
  length: number;
  tier: ClaimTier;
}

/** Clause-boundary start offsets, approximated by splitting on commas and
 *  semicolons — deliberately simple (not a real parser), used only to bound
 *  how far negation's shielding effect (see below) can reach. */
function clauseBoundaries(sentence: string): number[] {
  const starts = [0];
  const regex = /[,;]\s*/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(sentence)) !== null) starts.push(match.index + match[0].length);
  return starts;
}

function clauseIndexOf(position: number, boundaries: readonly number[]): number {
  let clause = 0;
  for (let i = 0; i < boundaries.length; i++) {
    if (position >= boundaries[i]!) clause = i;
  }
  return clause;
}

/**
 * Finds every claim-pattern match in `sentence` (V2.1.1) — every EXPERIENCE,
 * CAPABILITY, KNOWLEDGE, ASPIRATIONAL, and NEGATION pattern occurrence, each
 * tagged with its tier and *position*. Positions are what let
 * `resolveGoverningTier` associate a specific checked-term occurrence with
 * the claim phrase that actually governs it, instead of letting one
 * claim-pattern match anywhere in the sentence apply to every term in it.
 *
 * Two bounded refinements on top of the raw matches:
 *  1. A KNOWLEDGE/EXPERIENCE match nested INSIDE an ASPIRATIONAL/NEGATION
 *     match's own matched text is dropped, not treated as a second,
 *     independent claim — e.g. "develop my knowledge" (aspirational) and
 *     "knowledge of" (knowledge) both match on the shared word "knowledge"
 *     in "develop my knowledge of Kubernetes," but there is only one claim
 *     here (aspirational growth language), not two.
 *  2. An EXPERIENCE/CAPABILITY match in the SAME clause (comma/semicolon-
 *     delimited) as a NEGATION match is treated as negated too — "haven't
 *     directly built X" must not let "built" survive as its own,
 *     ungoverned experience claim just because it is a few words away from
 *     "haven't." This never reaches into a later, independent clause
 *     ("..., but I have experience with Y" is unaffected).
 */
function findClaimSpans(sentence: string): ClaimSpan[] {
  const rawSpans: ClaimSpan[] = [];
  const collect = (patterns: readonly RegExp[], tier: ClaimTier) => {
    for (const { index, length } of findAllPatternMatches(patterns, sentence)) {
      rawSpans.push({ index, length, tier });
    }
  };

  collect(NEGATION_OVERRIDE_PATTERNS, 'negation');
  collect(ASPIRATIONAL_OVERRIDE_PATTERNS, 'aspirational');
  collect(EXPERIENCE_CLAIM_PATTERNS, 'experience');
  collect(CAPABILITY_CLAIM_PATTERNS, 'experience');
  collect(KNOWLEDGE_CLAIM_PATTERNS, 'knowledge');

  const exemptSpans = rawSpans.filter((s) => isExemptTier(s.tier));
  const withoutNestedMatches = rawSpans.filter((span) => {
    if (isExemptTier(span.tier)) return true;
    return !exemptSpans.some((e) => span.index >= e.index && span.index < e.index + e.length);
  });

  const boundaries = clauseBoundaries(sentence);
  const negatedClauses = new Set(
    withoutNestedMatches
      .filter((s) => s.tier === 'negation')
      .map((s) => clauseIndexOf(s.index, boundaries)),
  );

  return withoutNestedMatches.map((span) =>
    (span.tier === 'experience' || span.tier === 'knowledge') &&
    negatedClauses.has(clauseIndexOf(span.index, boundaries))
      ? { ...span, tier: 'negation' }
      : span,
  );
}

/**
 * Resolves which claim tier governs a specific term occurrence at
 * `termIndex` — the *nearest* claim-pattern span, preferring one that
 * precedes the term (natural English word order: "familiarity with
 * Python," "can implement authentication" — the governing phrase comes
 * before its object) and falling back to the nearest one that follows only
 * if none precedes it. Returns undefined if no claim pattern exists
 * anywhere in the sentence (an unclaimed, bare mention — left unflagged, as
 * before).
 */
function resolveGoverningTier(
  termIndex: number,
  spans: readonly ClaimSpan[],
): ClaimTier | undefined {
  let nearestPreceding: ClaimSpan | undefined;
  let nearestFollowing: ClaimSpan | undefined;

  for (const span of spans) {
    if (span.index <= termIndex) {
      if (!nearestPreceding || span.index > nearestPreceding.index) nearestPreceding = span;
    } else if (!nearestFollowing || span.index < nearestFollowing.index) {
      nearestFollowing = span;
    }
  }

  return (nearestPreceding ?? nearestFollowing)?.tier;
}

/**
 * Returns a human-readable description of each unsupported possession claim
 * found in `letterText`, checked against `evidence` — the candidate's CV
 * split into experience vs skills-only tiers (see cv-evidence.util.ts), never
 * the job description. An empty array means no violation was found.
 *
 * V2.1.1: each checked-term OCCURRENCE is graded against the claim pattern
 * that actually governs *it* (by nearest position — see
 * resolveGoverningTier), not by whichever claim pattern happens to appear
 * anywhere in the same sentence. Production QA found the prior whole-sentence
 * classification treated an entire sentence as one experience-strength claim
 * the moment ANY part of it matched an experience/capability pattern — e.g.
 * "...provides a strong foundation for tackling the responsibilities of this
 * role" — which wrongly promoted unrelated, genuinely skills-only mentions
 * earlier in the same sentence ("my familiarity with Python, Java...") into
 * a requirement for work-history evidence, rejecting valid letters until all
 * retries were exhausted.
 *
 * Reliability fix (see the module report): a SOFT_SKILL_TERMS entry never
 * held to the strict experienceText-only bar even when its governing claim
 * pattern is nominally 'experience' tier. Unlike a technology — which has a
 * meaningful "used it on the job" vs. "merely listed" distinction — a soft
 * skill has no equivalent clean split; requiring one to be found in
 * experienceText specifically (and not, say, a structured CV's own skills
 * entry naming that trait) was an unintentionally stricter bar than hard
 * technologies get for a genuinely modest, honestly-hedged claim. Hard
 * technologies/concepts keep their existing tier bars completely unchanged
 * — including the deliberate skills-list-only capability-claim strictness
 * (see the "day one" test in possession-claim-guard.util.spec.ts).
 */
export function findUnsupportedPossessionClaims(
  letterText: string,
  evidence: CvEvidence,
): string[] {
  const violations: string[] = [];
  const fullEvidenceText = `${evidence.experienceText}\n${evidence.skillsOnlyTerms.join(', ')}`;

  for (const sentence of splitIntoSentences(letterText)) {
    const spans = findClaimSpans(sentence);
    if (spans.length === 0) continue; // no claim pattern anywhere — nothing to check

    for (const term of ALL_CHECKED_TERMS) {
      for (const termIndex of findWholePhraseIndices(sentence, term)) {
        const tier = resolveGoverningTier(termIndex, spans);
        if (tier === undefined || isExemptTier(tier)) continue;

        const isSoftSkill = (SOFT_SKILL_TERMS as readonly string[]).includes(term);
        const requiredEvidence =
          tier === 'experience' && !isSoftSkill ? evidence.experienceText : fullEvidenceText;
        if (!containsWholePhrase(requiredEvidence, term)) {
          violations.push(`"${term}" in: "${sentence}"`);
        }
      }
    }
  }

  return violations;
}
