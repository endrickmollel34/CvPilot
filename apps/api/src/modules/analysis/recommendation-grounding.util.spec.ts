import type { AtsKeyword, Suggestion } from '@cvpilot/shared';
import { groundSuggestions } from './recommendation-grounding.util';

function suggestion(overrides: Partial<Suggestion> = {}): Suggestion {
  return {
    category: 'MISSING_KEYWORD',
    priority: 'MEDIUM',
    text: 'placeholder suggestion text long enough to pass validation',
    ...overrides,
  };
}

const CV_TEXT =
  'Experienced backend engineer with 5 years of Node.js and PostgreSQL experience. ' +
  'Built and maintained RESTful APIs. Strong attention to detail across all projects.';

describe('groundSuggestions()', () => {
  // ─── E. Missing JD requirement with no CV evidence ─────────────────────────

  it('rewrites an unconditional instruction to add a keyword the CV does not contain', () => {
    const keywords: AtsKeyword[] = [{ keyword: 'Kubernetes', found: false }];
    const { suggestions, stats } = groundSuggestions(
      [suggestion({ text: 'Add "Kubernetes" — it appears in the job description.' })],
      CV_TEXT,
      keywords,
    );

    expect(stats.rewritten).toBe(1);
    expect(suggestions[0]?.text).not.toContain('Add "Kubernetes"');
    expect(suggestions[0]?.text.toLowerCase()).toContain('if you genuinely have');
    // must never assert or imply the candidate already has it
    expect(suggestions[0]?.text).not.toMatch(/\byou have\b/i);
  });

  it('leaves an already-conditional suggestion about an ungrounded keyword unchanged', () => {
    const keywords: AtsKeyword[] = [{ keyword: 'Kubernetes', found: false }];
    const original = suggestion({
      text: 'If you have experience with Kubernetes, add a specific example of using it.',
    });
    const { suggestions, stats } = groundSuggestions([original], CV_TEXT, keywords);

    expect(stats.rewritten).toBe(0);
    expect(suggestions[0]).toBe(original);
  });

  it('rewrites a WEAK_LANGUAGE suggestion that actually asserts an ungrounded keyword', () => {
    // Category mislabeling: the model called this WEAK_LANGUAGE, but it is
    // really asserting a missing, unsupported qualification — must still be
    // caught regardless of category (except STRUCTURE, which is unrelated).
    const keywords: AtsKeyword[] = [{ keyword: 'AWS certification', found: false }];
    const { suggestions, stats } = groundSuggestions(
      [
        suggestion({
          category: 'WEAK_LANGUAGE',
          text: 'Mention your AWS certification more prominently near the top of your CV.',
        }),
      ],
      CV_TEXT,
      keywords,
    );

    expect(stats.rewritten).toBe(1);
    expect(suggestions[0]?.text).not.toContain('your AWS certification');
  });

  it("never trusts the model's own found:true flag — re-derives grounding from the actual CV text", () => {
    // The model claims "found: true" for a term that is not actually in the
    // CV text — the deterministic check must catch this regardless.
    const keywords: AtsKeyword[] = [{ keyword: 'Scrum Master certification', found: true }];
    const { suggestions, stats } = groundSuggestions(
      [suggestion({ text: 'Add your Scrum Master certification to the certifications section.' })],
      CV_TEXT,
      keywords,
    );

    expect(stats.rewritten).toBe(1);
    expect(suggestions[0]?.text).not.toContain('Add your Scrum Master certification');
  });

  // ─── F. Existing CV evidence — may strengthen without inventing facts ──────

  it('does not rewrite a suggestion about a keyword that is genuinely present in the CV text', () => {
    const keywords: AtsKeyword[] = [{ keyword: 'PostgreSQL', found: true }];
    const original = suggestion({
      category: 'WEAK_LANGUAGE',
      text: 'Your PostgreSQL experience is mentioned briefly — expand it with a concrete example.',
    });
    const { suggestions, stats } = groundSuggestions([original], CV_TEXT, keywords);

    expect(stats.rewritten).toBe(0);
    expect(suggestions[0]).toBe(original);
  });

  it('does not rewrite a suggestion that names no key term at all', () => {
    const original = suggestion({
      category: 'STRUCTURE',
      text: 'Move the summary section above your work experience for better readability.',
    });
    const { suggestions, stats } = groundSuggestions([original], CV_TEXT, []);

    expect(stats.rewritten).toBe(0);
    expect(suggestions[0]).toBe(original);
  });

  // ─── G. Formatting — must not claim unsupported visual/formatting problems ─

  it('filters out a STRUCTURE suggestion claiming a visual-layout detail plain text cannot establish', () => {
    const { suggestions, stats } = groundSuggestions(
      [
        suggestion({
          category: 'STRUCTURE',
          text: 'Your CV uses a two-column table layout that ATS systems cannot parse.',
        }),
      ],
      CV_TEXT,
      [],
    );

    expect(stats.filteredFormatting).toBe(1);
    expect(suggestions).toHaveLength(0);
  });

  it('filters out an ATS_WARNING suggestion claiming graphics/images', () => {
    const { suggestions, stats } = groundSuggestions(
      [
        suggestion({
          category: 'ATS_WARNING',
          text: 'Remove the graphics and icons from your header — ATS cannot read images.',
        }),
      ],
      CV_TEXT,
      [],
    );

    expect(stats.filteredFormatting).toBe(1);
    expect(suggestions).toHaveLength(0);
  });

  it('keeps a STRUCTURE suggestion about something plain text genuinely establishes (section order/wording)', () => {
    const original = suggestion({
      category: 'STRUCTURE',
      text: 'Your CV has no dedicated Skills section — consider adding one to group your technical skills.',
    });
    const { suggestions, stats } = groundSuggestions([original], CV_TEXT, []);

    expect(stats.filteredFormatting).toBe(0);
    expect(suggestions[0]).toBe(original);
  });

  // ─── H. Recommendation duplication ──────────────────────────────────────────

  it('collapses two suggestions that name the same missing keyword in the same category', () => {
    const keywords: AtsKeyword[] = [{ keyword: 'Kubernetes', found: false }];
    const { suggestions, stats } = groundSuggestions(
      [
        suggestion({ text: 'If you have experience with Kubernetes, mention a concrete example.' }),
        suggestion({ text: 'If you know Kubernetes, add a specific example to your CV.' }),
      ],
      CV_TEXT,
      keywords,
    );

    expect(suggestions).toHaveLength(1);
    expect(stats.deduped).toBe(1);
  });

  it('collapses near-identical suggestion text even without a shared tracked keyword', () => {
    const { suggestions, stats } = groundSuggestions(
      [
        suggestion({
          category: 'STRUCTURE',
          text: 'Consider adding a professional summary at the top of your CV to introduce yourself.',
        }),
        suggestion({
          category: 'STRUCTURE',
          text: 'Consider adding a professional summary at the top of the CV to introduce yourself.',
        }),
      ],
      CV_TEXT,
      [],
    );

    expect(suggestions).toHaveLength(1);
    expect(stats.deduped).toBe(1);
  });

  it('keeps distinct suggestions about different keywords in the same category', () => {
    const keywords: AtsKeyword[] = [
      { keyword: 'Kubernetes', found: false },
      { keyword: 'Terraform', found: false },
    ];
    const { suggestions, stats } = groundSuggestions(
      [
        suggestion({ text: 'If you have experience with Kubernetes, add a concrete example.' }),
        suggestion({ text: 'If you have experience with Terraform, add a concrete example.' }),
      ],
      CV_TEXT,
      keywords,
    );

    expect(suggestions).toHaveLength(2);
    expect(stats.deduped).toBe(0);
  });

  // ─── Integration of all three passes ────────────────────────────────────────

  it('applies filtering, rewriting, and deduping together without touching unrelated suggestions', () => {
    const keywords: AtsKeyword[] = [{ keyword: 'Kubernetes', found: false }];
    const { suggestions, stats } = groundSuggestions(
      [
        suggestion({
          category: 'STRUCTURE',
          text: 'Your CV uses decorative graphics that ATS cannot parse.',
        }),
        suggestion({ text: 'Add Kubernetes to your skills section.' }),
        suggestion({ text: 'Include Kubernetes as a skill you have used.' }),
        suggestion({
          category: 'WEAK_LANGUAGE',
          text: 'Your PostgreSQL experience is understated — describe the scale of the database you worked with.',
        }),
      ],
      CV_TEXT,
      keywords,
    );

    expect(stats.filteredFormatting).toBe(1);
    expect(stats.rewritten).toBe(2);
    expect(stats.deduped).toBe(1); // the two rewritten Kubernetes suggestions collapse into one
    expect(suggestions).toHaveLength(2);
    expect(suggestions.some((s) => s.text.includes('PostgreSQL'))).toBe(true);
  });
});
