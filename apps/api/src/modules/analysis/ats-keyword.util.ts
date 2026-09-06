import type { AtsKeyword } from '@cvpilot/shared';

/**
 * ATS Keyword Quality V2 — deterministic keyword classification + weighted
 * scoring.
 *
 * Root cause this fixes: the AI directly emits `ats_keywords` (ai.service.ts)
 * and AnalysisService.process() previously computed the ATS score as a flat,
 * unweighted ratio — `keywordHits.length / ats_keywords.length * 100` —
 * trusting the model's own `found` flag at face value for every entry
 * equally. A concrete requirement like "Docker" counted exactly the same as
 * a bare generic verb like "maintaining" or a soft skill like "attention to
 * detail". For a typical JD this list is dominated by generic/soft/
 * contextual noise, so missing 2-3 genuine hard skills produced a
 * catastrophically low, misleading score, and MISSING_KEYWORD
 * recommendations piled up one-per-noise-phrase.
 *
 * This module never trusts the model's raw `keyword` list or `found` flags
 * directly for scoring purposes — same "prompt is not enforcement, add a
 * deterministic backstop" philosophy as recommendation-grounding.util.ts
 * (Analysis), possession-claim-guard.util.ts (Cover Letter), and
 * skill-grounding.util.ts / tailoring-grounding.util.ts (Tailoring). It:
 *
 *  1. Classifies each keyword into one of 5 categories via small, bounded,
 *     curated term lists — never NLP — with a fixed importance weight per
 *     category (classifyKeyword). Unrecognized keywords default to the
 *     TECHNICAL_CONCEPT weight rather than 0 or the maximum: a specific but
 *     uncatalogued technology mention should still count meaningfully
 *     (never zeroed just because it isn't in a curated list), while known
 *     noise (a handful of exact generic verbs/contextual filler phrases) is
 *     the only thing excluded from scoring entirely.
 *  2. Deduplicates near-identical keyword phrasings (e.g. "REST API" /
 *     "REST APIs", "Postgres" / "PostgreSQL") via a small bounded alias map
 *     — never a general normalization/stemming system — so a JD requirement
 *     restated in two different but equivalent phrasings is never counted,
 *     or penalized, twice.
 *  3. Independently RE-VERIFIES `found` against the actual CV text using
 *     the same alias-aware whole-phrase matching, rather than trusting the
 *     model's own self-reported flag — extending the "never trust the
 *     model's found flag" principle already stated in
 *     recommendation-grounding.util.ts's header to the score itself, which
 *     previously did not have this backstop at all.
 *
 * computeAtsScore then weights genuinely job-specific, verifiable evidence
 * (HARD_SKILL, TECHNICAL_CONCEPT) far more heavily than role/domain framing
 * or soft skills, and excludes generic/contextual noise entirely — so the
 * score reflects concrete technical fit rather than every noun/verb phrase
 * the model happened to list.
 */

export type KeywordCategory =
  | 'HARD_SKILL'
  | 'TECHNICAL_CONCEPT'
  | 'ROLE_OR_DOMAIN'
  | 'SOFT_SKILL'
  | 'GENERIC_OR_CONTEXTUAL';

export interface ClassifiedKeyword extends AtsKeyword {
  category: KeywordCategory;
  weight: number;
}

// Design guidance from the ATS Keyword Quality V2 task, adopted as-is: it
// cleanly fits this architecture with no need for a more elaborate model.
// Unrecognized keywords are NOT zero — they default to the TECHNICAL_CONCEPT
// weight (see classifyKeyword) so an uncatalogued but specific requirement
// still counts, rather than either disappearing or dominating the score.
const WEIGHTS: Record<KeywordCategory, number> = {
  HARD_SKILL: 3,
  TECHNICAL_CONCEPT: 2,
  ROLE_OR_DOMAIN: 1.5,
  SOFT_SKILL: 0.5,
  GENERIC_OR_CONTEXTUAL: 0,
};

// normalize()'s generic punctuation stripping below treats "+" and "#" like
// any other punctuation, which collapses "C++", "C#", and plain "C" into the
// same token "c" — unacceptable for an ATS product, since these are
// distinct programming languages that must never satisfy each other's
// requirements. Fixed at the narrowest point: before generic stripping
// runs, these two specific symbol-bearing tokens are swapped for
// alphanumeric placeholders that survive it intact and stay distinct from
// bare "c". Word-boundary-anchored and case-insensitive so "c++"/"C++" and
// "c#"/"C#" both match regardless of case, without touching any other
// punctuation normalization (REST API/APIs, Postgres/PostgreSQL, CI/CD vs
// CI-CD, etc. are untouched by this substitution).
function preserveDistinctSymbolTerms(text: string): string {
  return text
    .replace(/\bc\+\+(?![a-z0-9])/gi, ' cplusplus ')
    .replace(/\bc#(?![a-z0-9])/gi, ' csharp ');
}

function normalize(text: string): string {
  return preserveDistinctSymbolTerms(text)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Whole-word/whole-phrase containment, not a loose substring match — same
 *  pattern used throughout the codebase's other grounding utils. */
function containsWholePhrase(haystack: string, phrase: string): boolean {
  const normPhrase = normalize(phrase);
  if (!normPhrase) return false;
  const normHaystack = normalize(haystack);
  const escaped = normPhrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|\\s)${escaped}($|\\s)`).test(normHaystack);
}

function matchesAny(text: string, terms: Iterable<string>): boolean {
  for (const term of terms) {
    if (containsWholePhrase(text, term)) return true;
  }
  return false;
}

// ── Bounded alias map (STEP 5) ────────────────────────────────────────────
// Deliberately narrow: only concretely observed near-duplicate JD phrasings
// that name the SAME underlying requirement. Keys are already `normalize()`d
// (plain lowercase alnum+space). NOT a general synonym/stemming system — e.g.
// "database" is intentionally NOT aliased to "relational databases" here,
// since that would be an unjustified over-normalization (a generic
// "database" requirement is not necessarily the same claim as "relational
// databases" specifically).
const KEYWORD_ALIASES: Record<string, string> = {
  'rest apis': 'rest api',
  'restful api': 'rest api',
  'restful apis': 'rest api',
  postgres: 'postgresql',
  'api integrations': 'api integration',
  'third party api integration': 'api integration',
  'third party api integrations': 'api integration',
  'integrating third party apis': 'api integration',
  'ci cd pipeline': 'ci cd',
  'ci cd pipelines': 'ci cd',
};

function canonicalize(rawKeyword: string): string {
  const normalized = normalize(rawKeyword);
  return KEYWORD_ALIASES[normalized] ?? normalized;
}

/** All known phrasings (raw + canonical + sibling aliases) for a keyword —
 *  used to check CV support in either direction (JD says "PostgreSQL", CV
 *  says "Postgres", or vice versa). */
function searchPhrases(rawKeyword: string): string[] {
  const canonical = canonicalize(rawKeyword);
  const phrases = new Set<string>([normalize(rawKeyword), canonical]);
  for (const [variant, canon] of Object.entries(KEYWORD_ALIASES)) {
    if (canon === canonical) phrases.add(variant);
  }
  return [...phrases];
}

function isKeywordSupportedByCv(rawKeyword: string, cvText: string): boolean {
  return searchPhrases(rawKeyword).some((phrase) => containsWholePhrase(cvText, phrase));
}

// ── Classification term lists (STEP 2) ────────────────────────────────────
// All entries are written in ALREADY-`normalize()`d form (lowercase, no
// punctuation) so they compare cleanly against a canonicalized keyword.
// Bounded, curated, deterministic — never NLP — mirroring the scope of
// every other grounding term list in this codebase (KNOWN_TECH_TERMS in
// tailoring-grounding.util.ts, etc.). Not exhaustive; extend only for
// concretely observed gaps.

const HARD_SKILL_TERMS = new Set<string>([
  'python',
  'java',
  'javascript',
  'typescript',
  'c',
  'cplusplus', // "C++" — kept distinct from "c" and "csharp" (see preserveDistinctSymbolTerms)
  'csharp', // "C#" — kept distinct from "c" and "cplusplus" (see preserveDistinctSymbolTerms)
  'go',
  'golang',
  'rust',
  'ruby',
  'php',
  'kotlin',
  'swift',
  'scala',
  'perl',
  'postgresql',
  'mysql',
  'mongodb',
  'redis',
  'sqlite',
  'oracle',
  'dynamodb',
  'cassandra',
  'elasticsearch',
  'mariadb',
  'docker',
  'kubernetes',
  'terraform',
  'ansible',
  'jenkins',
  'git',
  'github',
  'gitlab',
  'bitbucket',
  'aws',
  'azure',
  'gcp',
  'google cloud',
  'google cloud platform',
  'react',
  'angular',
  'vue',
  'vue js',
  'node js',
  'express',
  'express js',
  'django',
  'flask',
  'spring',
  'spring boot',
  'rails',
  'ruby on rails',
  'laravel',
  'asp net',
  'dotnet',
  'net core',
  'graphql',
  'grpc',
  'kafka',
  'rabbitmq',
  'nginx',
  'apache',
  'linux',
  'unix',
  'bash',
  'html',
  'css',
  'sass',
  'tailwind',
  'tailwind css',
  'webpack',
  'next js',
  'nuxt',
  'tensorflow',
  'pytorch',
  'pandas',
  'numpy',
  'scikit learn',
  'jira',
  'confluence',
  'circleci',
  'github actions',
  'travis ci',
]);

const TECHNICAL_CONCEPT_TERMS = new Set<string>([
  'rest api',
  'soap api',
  'graphql api',
  'api design',
  'api integration',
  'authentication',
  'authorization',
  'oauth',
  'oauth2',
  'sso',
  'single sign on',
  'jwt',
  'database design',
  'relational database',
  'relational databases',
  'nosql',
  'nosql database',
  'microservices',
  'microservice architecture',
  'service oriented architecture',
  'event driven architecture',
  'message queue',
  'message queues',
  'message queuing',
  'ci cd',
  'continuous integration',
  'continuous deployment',
  'continuous delivery',
  'automated testing',
  'unit testing',
  'integration testing',
  'test automation',
  'test driven development',
  'caching',
  'load balancing',
  'containerization',
  'orchestration',
  'cloud platform',
  'cloud platforms',
  'cloud computing',
  'infrastructure as code',
  'version control',
  'system design',
  'data structures',
  'data structures and algorithms',
  'algorithms',
  'security best practices',
  'application security',
  'api security',
  'monitoring and logging',
  'observability',
  'logging and monitoring',
  'web services',
  'ai api integration',
  'ai api integrations',
  'third party integrations',
]);

// Specific curated role/domain phrases — matched exactly against the
// canonicalized keyword.
const ROLE_OR_DOMAIN_TERMS = new Set<string>([
  'backend software engineer',
  'backend engineering',
  'distributed systems',
  'software engineering',
  'backend development',
  'frontend development',
  'full stack development',
  'site reliability engineering',
]);

// Whole-word containment heuristic for role/title variants too numerous to
// enumerate (e.g. "Senior Backend Engineer", "Backend Developer") — the one
// deliberate exception to exact-match-only classification, since job titles
// are inherently open-ended.
const ROLE_SUFFIX_WORDS: readonly string[] = [
  'engineer',
  'developer',
  'architect',
  'administrator',
  'programmer',
  'scientist',
];

const SOFT_SKILL_TERMS = new Set<string>([
  'problem solving',
  'problem solving skills',
  'communication',
  'communication skills',
  'good communication skills',
  'strong communication skills',
  'excellent communication skills',
  'attention to detail',
  'teamwork',
  'team player',
  'collaboration',
  'leadership',
  'adaptability',
  'time management',
  'interpersonal skills',
  'critical thinking',
  'creativity',
  'organizational skills',
  'work ethic',
]);

// Bare generic verbs — ONLY classified generic when the ENTIRE keyword is
// just this verb (or a small curated compound), never when it is part of a
// longer, meaningful technical phrase (see the module header).
const GENERIC_VERBS = new Set<string>([
  'developing',
  'maintaining',
  'designing',
  'testing',
  'supporting',
  'working',
  'building',
  'implementing',
  'creating',
  'managing',
  'delivering',
  'ensuring',
  'providing',
  'contributing',
  'participating',
  'assisting',
  'performing',
  'executing',
  'handling',
  'developing and maintaining',
  'designing and testing',
]);

const GENERIC_CONTEXTUAL_PHRASES = new Set<string>([
  'reliable backend services',
  'dynamic environment',
  'dynamic development team',
  'agile development team',
  'agile team',
  'fast paced environment',
  'collaborative environment',
  'growing team',
  'cutting edge technology',
  'cutting edge technologies',
  'innovative environment',
  'exciting opportunity',
  'challenging environment',
]);

/** Classifies a single raw JD keyword into a category + importance weight.
 *  See the module header for the full design rationale and precedence
 *  order (HARD_SKILL > TECHNICAL_CONCEPT > ROLE_OR_DOMAIN > SOFT_SKILL >
 *  GENERIC_OR_CONTEXTUAL > unrecognized default). */
export function classifyKeyword(rawKeyword: string): { category: KeywordCategory; weight: number } {
  const canonical = canonicalize(rawKeyword);

  if (HARD_SKILL_TERMS.has(canonical)) {
    return { category: 'HARD_SKILL', weight: WEIGHTS.HARD_SKILL };
  }
  if (TECHNICAL_CONCEPT_TERMS.has(canonical)) {
    return { category: 'TECHNICAL_CONCEPT', weight: WEIGHTS.TECHNICAL_CONCEPT };
  }
  if (ROLE_OR_DOMAIN_TERMS.has(canonical) || matchesAny(canonical, ROLE_SUFFIX_WORDS)) {
    return { category: 'ROLE_OR_DOMAIN', weight: WEIGHTS.ROLE_OR_DOMAIN };
  }
  if (SOFT_SKILL_TERMS.has(canonical)) {
    return { category: 'SOFT_SKILL', weight: WEIGHTS.SOFT_SKILL };
  }
  if (GENERIC_VERBS.has(canonical) || GENERIC_CONTEXTUAL_PHRASES.has(canonical)) {
    return { category: 'GENERIC_OR_CONTEXTUAL', weight: WEIGHTS.GENERIC_OR_CONTEXTUAL };
  }

  // Unrecognized — conservative default (see module header): counts as a
  // real, moderate-importance technical requirement rather than being
  // dropped or dominating the score.
  return { category: 'TECHNICAL_CONCEPT', weight: WEIGHTS.TECHNICAL_CONCEPT };
}

/**
 * Merges near-duplicate keyword phrasings (STEP 5), classifies each into a
 * category + weight, and independently re-verifies `found` against the
 * actual CV text (never trusting the model's own flag — see module header).
 * `cvText` must be exactly the text the AI was given.
 */
export function classifyAndVerifyKeywords(
  atsKeywords: readonly AtsKeyword[],
  cvText: string,
): ClassifiedKeyword[] {
  const byCanonical = new Map<string, string>(); // canonical -> display label (first seen)

  for (const { keyword } of atsKeywords) {
    if (!keyword?.trim()) continue;
    const canonical = canonicalize(keyword);
    if (!byCanonical.has(canonical)) {
      byCanonical.set(canonical, keyword.trim());
    }
  }

  const result: ClassifiedKeyword[] = [];
  for (const display of byCanonical.values()) {
    const { category, weight } = classifyKeyword(display);
    const found = isKeywordSupportedByCv(display, cvText);
    result.push({ keyword: display, found, category, weight });
  }
  return result;
}

/**
 * Weighted ATS score (STEP 3): GENERIC_OR_CONTEXTUAL keywords (weight 0)
 * are excluded from both the numerator and denominator entirely, so they
 * cannot depress — or inflate — the score either way. If every classified
 * keyword is weight-0 (or there are none at all), the score is 0 — the same
 * "nothing meaningful to measure" convention already used for an empty
 * keyword list.
 */
export function computeAtsScore(classified: readonly ClassifiedKeyword[]): number {
  const scorable = classified.filter((k) => k.weight > 0);
  const totalWeight = scorable.reduce((sum, k) => sum + k.weight, 0);
  if (totalWeight === 0) return 0;
  const matchedWeight = scorable.filter((k) => k.found).reduce((sum, k) => sum + k.weight, 0);
  return Math.round((matchedWeight / totalWeight) * 100);
}
