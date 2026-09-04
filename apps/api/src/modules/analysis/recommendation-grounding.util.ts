import type { AtsKeyword, Suggestion } from '@cvpilot/shared';

/**
 * Deterministic, non-LLM post-processing for analysis recommendations.
 *
 * Why this exists: the analysis prompt (see ai.service.ts) instructs the
 * model to phrase a missing-requirement suggestion conditionally (e.g. "If
 * you have experience with X...") rather than telling the candidate to just
 * add it, and to never invent visual/layout claims plain extracted text
 * cannot establish — but prompts are not enforcement. A model can still
 * ignore the instruction. This module re-checks the model's own suggestions
 * against the CV text it was actually given, mirroring the same
 * belt-and-suspenders approach already used for cover letters
 * (possession-claim-guard.util.ts) and tailoring (skill-grounding.util.ts):
 *
 *  1. Formatting/structure suggestions that assert a visual-layout detail
 *     (tables, columns, graphics, fonts, ...) are dropped outright — plain
 *     text extraction (see ParsingService) can never establish these, so
 *     there is no safe rewrite, only removal.
 *  2. A suggestion that names a job-description key term not actually
 *     present in the CV text, and is phrased as an unconditional
 *     instruction to add/claim it, is rewritten into a safe conditional
 *     template. This never trusts the AI's own `found` flag on
 *     ats_keywords — it independently re-checks the term against the CV
 *     text, the same way the AI's `found` flags feed the ATS score.
 *  3. Suggestions that end up duplicating another suggestion — either by
 *     naming the same key term in the same category, or by being
 *     near-identical text — are collapsed to the first occurrence.
 *
 * This never touches match_score or the ats_keywords/found flags used for
 * the ATS score — scores and recommendation wording are intentionally kept
 * independent (see AnalysisService.process()).
 */

export interface GroundingStats {
  rewritten: number;
  filteredFormatting: number;
  deduped: number;
}

export interface GroundedSuggestions {
  suggestions: Suggestion[];
  stats: GroundingStats;
}

// Visual/layout details plain-text extraction (pdf-parse / mammoth
// extractRawText — see ParsingService) can never establish. A STRUCTURE or
// ATS_WARNING suggestion asserting one of these is an unfounded claim about
// data CVPilot never actually received, not a real observation.
const UNSUPPORTED_FORMATTING_TERMS: readonly string[] = [
  'table',
  'tables',
  'column',
  'columns',
  'multi-column',
  'multicolumn',
  'graphic',
  'graphics',
  'image',
  'images',
  'photo',
  'photos',
  'chart',
  'charts',
  'infographic',
  'infographics',
  'icon',
  'icons',
  'text box',
  'text boxes',
  'color scheme',
  'colour scheme',
  'font',
  'fonts',
  'logo',
];

// A suggestion matching any of these is already phrased conditionally — it
// does not need rewriting, regardless of what key terms it mentions.
const CONDITIONAL_PHRASING_PATTERNS: readonly RegExp[] = [
  /\bif you (have|possess|genuinely have|are familiar|hold|(’|')ve)\b/i,
  /\bif (this|it) (applies|is true|is accurate|genuinely applies)\b/i,
  /\bif applicable\b/i,
  /\bwhere (genuinely )?true\b/i,
  /\bonly if\b/i,
  /\bassuming you\b/i,
  /\bif you'?re\b/i,
  /\bif you do\b/i,
];

function normalize(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Whole-word/whole-phrase containment, not a loose substring match — "art"
 *  must not match inside "party", "AWS" must not match inside "jAWSome". */
function containsWholePhrase(haystack: string, phrase: string): boolean {
  const normPhrase = normalize(phrase);
  if (!normPhrase) return false;
  const normHaystack = normalize(haystack);
  const escaped = normPhrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|\\s)${escaped}($|\\s)`).test(normHaystack);
}

function hasUnsupportedFormattingClaim(suggestion: Suggestion): boolean {
  if (suggestion.category !== 'STRUCTURE' && suggestion.category !== 'ATS_WARNING') return false;
  return UNSUPPORTED_FORMATTING_TERMS.some((term) => containsWholePhrase(suggestion.text, term));
}

function isConditionallyPhrased(text: string): boolean {
  return CONDITIONAL_PHRASING_PATTERNS.some((pattern) => pattern.test(text));
}

/** Key terms (from the model's own ats_keywords list) that this suggestion's
 *  text actually names — independent of the model's `found` flag. */
function mentionedKeywords(text: string, keywords: readonly string[]): string[] {
  return keywords.filter((kw) => containsWholePhrase(text, kw));
}

function buildConditionalRewrite(keywords: readonly string[]): string {
  const list = keywords.map((k) => `"${k}"`).join(', ');
  return (
    `The job description mentions ${list}, which doesn't clearly appear on your CV. ` +
    `If you genuinely have relevant experience, add a specific, concrete example of it — ` +
    `don't add it unless it's true, as that could misrepresent your background.`
  );
}

/**
 * Rewrites a suggestion that unconditionally tells the candidate to add,
 * claim, or imply a job-description term not actually present in the CV
 * text. Suggestions already phrased conditionally, or that mention no
 * ungrounded term, are returned unchanged (same object reference).
 */
function groundSingleSuggestion(
  suggestion: Suggestion,
  cvText: string,
  keywords: readonly string[],
): Suggestion {
  if (suggestion.category === 'STRUCTURE') return suggestion; // not keyword-related

  const mentioned = mentionedKeywords(suggestion.text, keywords);
  if (mentioned.length === 0) return suggestion;

  const ungrounded = mentioned.filter((kw) => !containsWholePhrase(cvText, kw));
  if (ungrounded.length === 0) return suggestion; // every mentioned term is genuinely on the CV

  if (isConditionallyPhrased(suggestion.text)) return suggestion; // already safely worded

  return { ...suggestion, text: buildConditionalRewrite(ungrounded) };
}

function wordSet(text: string): Set<string> {
  return new Set(normalize(text).split(' ').filter(Boolean));
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let intersection = 0;
  for (const token of a) if (b.has(token)) intersection++;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

const NEAR_DUPLICATE_THRESHOLD = 0.75;

/** Collapses suggestions that duplicate an earlier one — either by naming
 *  the same key term within the same category, or by being near-identical
 *  text — keeping the first occurrence of each.
 *
 *  The near-identical-text check is scoped to suggestions sharing the same
 *  primary keyword (or both naming none) — otherwise two suggestions about
 *  genuinely different missing keywords can read as near-duplicates purely
 *  because the conditional-rewrite template (buildConditionalRewrite) wraps
 *  them in mostly the same boilerplate wording, e.g. "...experience with
 *  Kubernetes..." vs "...experience with Terraform..." differ by one word
 *  out of ten — a real, deliberately distinct pair, not a duplicate. */
function dedupeSuggestions(
  suggestions: readonly Suggestion[],
  keywords: readonly string[],
): { kept: Suggestion[]; removed: number } {
  const seenKeywordCategory = new Set<string>();
  const kept: Suggestion[] = [];
  const keptEntries: Array<{ category: string; keyword?: string; words: Set<string> }> = [];
  let removed = 0;

  for (const suggestion of suggestions) {
    const primaryKeyword = mentionedKeywords(suggestion.text, keywords)[0];
    const normalizedKeyword = primaryKeyword ? normalize(primaryKeyword) : undefined;
    const keywordCategoryKey = normalizedKeyword
      ? `${suggestion.category}:${normalizedKeyword}`
      : undefined;

    if (keywordCategoryKey && seenKeywordCategory.has(keywordCategoryKey)) {
      removed++;
      continue;
    }

    const words = wordSet(suggestion.text);
    const isNearDuplicate = keptEntries.some(
      (existing) =>
        existing.category === suggestion.category &&
        existing.keyword === normalizedKeyword &&
        jaccardSimilarity(existing.words, words) >= NEAR_DUPLICATE_THRESHOLD,
    );
    if (isNearDuplicate) {
      removed++;
      continue;
    }

    if (keywordCategoryKey) seenKeywordCategory.add(keywordCategoryKey);
    keptEntries.push({ category: suggestion.category, keyword: normalizedKeyword, words });
    kept.push(suggestion);
  }

  return { kept, removed };
}

/**
 * Applies all deterministic grounding safeguards to a raw set of AI-produced
 * suggestions. `cvText` must be exactly the text the AI was given (so a
 * "grounded" check reflects what the model could have known), and
 * `atsKeywords` should be the model's own extracted job-description key
 * terms for the same analysis.
 */
export function groundSuggestions(
  suggestions: readonly Suggestion[],
  cvText: string,
  atsKeywords: readonly AtsKeyword[],
): GroundedSuggestions {
  const keywords = atsKeywords.map((k) => k.keyword);

  const withoutFormattingClaims = suggestions.filter((s) => !hasUnsupportedFormattingClaim(s));
  const filteredFormatting = suggestions.length - withoutFormattingClaims.length;

  const groundedList = withoutFormattingClaims.map((s) =>
    groundSingleSuggestion(s, cvText, keywords),
  );
  const rewritten = groundedList.filter((s, i) => s !== withoutFormattingClaims[i]).length;

  const { kept, removed } = dedupeSuggestions(groundedList, keywords);

  return {
    suggestions: kept,
    stats: { rewritten, filteredFormatting, deduped: removed },
  };
}
