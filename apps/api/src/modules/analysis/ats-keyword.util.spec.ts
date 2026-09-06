import type { AtsKeyword } from '@cvpilot/shared';
import { classifyKeyword, classifyAndVerifyKeywords, computeAtsScore } from './ats-keyword.util';

describe('classifyKeyword()', () => {
  it('classifies concrete technologies as HARD_SKILL', () => {
    expect(classifyKeyword('Python').category).toBe('HARD_SKILL');
    expect(classifyKeyword('Docker').category).toBe('HARD_SKILL');
    expect(classifyKeyword('PostgreSQL').category).toBe('HARD_SKILL');
  });

  // C / C++ / C# distinctness — normalize()'s generic punctuation stripping
  // previously collapsed all three into the same "c" token.
  it('classifies C, C++, and C# as distinct HARD_SKILL entries, case-insensitively', () => {
    for (const variant of ['C', 'c']) {
      expect(classifyKeyword(variant).category).toBe('HARD_SKILL');
    }
    for (const variant of ['C++', 'c++']) {
      expect(classifyKeyword(variant).category).toBe('HARD_SKILL');
    }
    for (const variant of ['C#', 'c#']) {
      expect(classifyKeyword(variant).category).toBe('HARD_SKILL');
    }
  });

  it('classifies technical concepts as TECHNICAL_CONCEPT', () => {
    expect(classifyKeyword('REST APIs').category).toBe('TECHNICAL_CONCEPT');
    expect(classifyKeyword('microservices').category).toBe('TECHNICAL_CONCEPT');
    expect(classifyKeyword('CI/CD').category).toBe('TECHNICAL_CONCEPT');
    expect(classifyKeyword('database design').category).toBe('TECHNICAL_CONCEPT');
  });

  it('classifies job titles/domain phrases as ROLE_OR_DOMAIN', () => {
    expect(classifyKeyword('Backend Software Engineer').category).toBe('ROLE_OR_DOMAIN');
    expect(classifyKeyword('Senior Backend Engineer').category).toBe('ROLE_OR_DOMAIN');
    expect(classifyKeyword('distributed systems').category).toBe('ROLE_OR_DOMAIN');
  });

  it('classifies soft skills as SOFT_SKILL, including verbose wrapping', () => {
    expect(classifyKeyword('attention to detail').category).toBe('SOFT_SKILL');
    expect(classifyKeyword('communication').category).toBe('SOFT_SKILL');
    expect(classifyKeyword('good communication skills').category).toBe('SOFT_SKILL');
    expect(classifyKeyword('problem-solving skills').category).toBe('SOFT_SKILL');
  });

  it('classifies bare generic verbs and contextual filler as GENERIC_OR_CONTEXTUAL', () => {
    for (const verb of ['developing', 'maintaining', 'designing', 'testing']) {
      expect(classifyKeyword(verb).category).toBe('GENERIC_OR_CONTEXTUAL');
      expect(classifyKeyword(verb).weight).toBe(0);
    }
    expect(classifyKeyword('reliable backend services').category).toBe('GENERIC_OR_CONTEXTUAL');
    expect(classifyKeyword('agile development team').category).toBe('GENERIC_OR_CONTEXTUAL');
  });

  it('defaults an unrecognized keyword to a moderate TECHNICAL_CONCEPT-equivalent weight, never zero', () => {
    const result = classifyKeyword('some uncatalogued but specific technology');
    expect(result.weight).toBeGreaterThan(0);
    expect(result.category).toBe('TECHNICAL_CONCEPT');
  });

  it('the importance invariant: HARD_SKILL outweighs SOFT_SKILL, and TECHNICAL_CONCEPT outweighs SOFT_SKILL', () => {
    expect(classifyKeyword('Docker').weight).toBeGreaterThan(
      classifyKeyword('attention to detail').weight,
    );
    expect(classifyKeyword('REST APIs').weight).toBeGreaterThan(
      classifyKeyword('attention to detail').weight,
    );
  });
});

describe('classifyAndVerifyKeywords() — normalization, aliasing, deterministic found', () => {
  // (B) Postgres in the CV should match a PostgreSQL requirement.
  it('(B) matches "Postgres" in the CV against a "PostgreSQL" JD requirement', () => {
    const keywords: AtsKeyword[] = [{ keyword: 'PostgreSQL', found: false }];
    const cvText = 'Built services backed by Postgres for high write throughput.';
    const [result] = classifyAndVerifyKeywords(keywords, cvText);
    expect(result?.found).toBe(true);
  });

  // (C) REST API vs REST APIs should match regardless of which form the CV
  // or JD uses.
  it('(C) matches "REST API" (JD) against "REST APIs" (CV)', () => {
    const keywords: AtsKeyword[] = [{ keyword: 'REST API', found: false }];
    const cvText = 'Designed and shipped several REST APIs for internal tooling.';
    const [result] = classifyAndVerifyKeywords(keywords, cvText);
    expect(result?.found).toBe(true);
  });

  it('(C reverse) matches "REST APIs" (JD) against "REST API" (CV)', () => {
    const keywords: AtsKeyword[] = [{ keyword: 'REST APIs', found: false }];
    const cvText = 'Built a REST API for the checkout flow.';
    const [result] = classifyAndVerifyKeywords(keywords, cvText);
    expect(result?.found).toBe(true);
  });

  // (H) Duplicate/variant keywords must not double-penalize.
  it('(H) merges "REST API" and "REST APIs" JD entries into a single classified keyword', () => {
    const keywords: AtsKeyword[] = [
      { keyword: 'REST API', found: false },
      { keyword: 'REST APIs', found: false },
    ];
    const cvText = 'Backend engineer with 3 years of experience.';
    const result = classifyAndVerifyKeywords(keywords, cvText);
    expect(result).toHaveLength(1);
  });

  it('never trusts the model own found:true flag — independently re-verifies against CV text', () => {
    const keywords: AtsKeyword[] = [{ keyword: 'Kubernetes', found: true }];
    const cvText = 'Experienced backend engineer with Node.js experience.';
    const [result] = classifyAndVerifyKeywords(keywords, cvText);
    expect(result?.found).toBe(false);
  });

  it('never trusts the model own found:false flag — independently re-verifies against CV text', () => {
    const keywords: AtsKeyword[] = [{ keyword: 'Docker', found: false }];
    const cvText = 'Containerized services with Docker for local development.';
    const [result] = classifyAndVerifyKeywords(keywords, cvText);
    expect(result?.found).toBe(true);
  });

  // ─── C / C++ / C# distinctness (correctness fix) ─────────────────────────
  // These are distinct programming languages and must never satisfy each
  // other's requirements, regardless of case.

  it('JD "C++", CV "C" => NOT matched', () => {
    const [result] = classifyAndVerifyKeywords(
      [{ keyword: 'C++', found: false }],
      'Experience with C.',
    );
    expect(result?.found).toBe(false);
  });

  it('JD "C#", CV "C" => NOT matched', () => {
    const [result] = classifyAndVerifyKeywords(
      [{ keyword: 'C#', found: false }],
      'Experience with C.',
    );
    expect(result?.found).toBe(false);
  });

  it('JD "C", CV "C++" => NOT matched', () => {
    const [result] = classifyAndVerifyKeywords(
      [{ keyword: 'C', found: false }],
      'Experience with C++.',
    );
    expect(result?.found).toBe(false);
  });

  it('JD "C#", CV "C++" => NOT matched', () => {
    const [result] = classifyAndVerifyKeywords(
      [{ keyword: 'C#', found: false }],
      'Experience with C++.',
    );
    expect(result?.found).toBe(false);
  });

  it('JD "C++", CV "C++" => matched, case-insensitively', () => {
    const [result] = classifyAndVerifyKeywords(
      [{ keyword: 'C++', found: false }],
      'Experience with c++.',
    );
    expect(result?.found).toBe(true);
  });

  it('JD "C#", CV "C#" => matched, case-insensitively', () => {
    const [result] = classifyAndVerifyKeywords(
      [{ keyword: 'C#', found: false }],
      'Experience with c#.',
    );
    expect(result?.found).toBe(true);
  });

  it('JD "C", CV "C" => matched, case-insensitively', () => {
    const [result] = classifyAndVerifyKeywords(
      [{ keyword: 'C', found: false }],
      'Experience with c.',
    );
    expect(result?.found).toBe(true);
  });

  it('merging/deduping still treats C, C++, and C# as three distinct classified keywords', () => {
    const result = classifyAndVerifyKeywords(
      [
        { keyword: 'C', found: false },
        { keyword: 'C++', found: false },
        { keyword: 'C#', found: false },
      ],
      'No relevant experience.',
    );
    expect(result).toHaveLength(3);
  });

  it('does NOT over-normalize "database" into matching "relational databases" (no alias merge)', () => {
    const keywords: AtsKeyword[] = [
      { keyword: 'database', found: false },
      { keyword: 'relational databases', found: false },
    ];
    const cvText = 'No database experience mentioned.';
    const result = classifyAndVerifyKeywords(keywords, cvText);
    // Deliberately NOT merged — two distinct classified entries survive.
    expect(result).toHaveLength(2);
  });
});

describe('computeAtsScore() — weighted scoring', () => {
  // (A) JD: Python, Docker, REST APIs, maintaining, attention to detail —
  // CV: Python only.
  it('(A) weights technical requirements heavily and excludes/minimizes generic and soft-skill noise', () => {
    const keywords: AtsKeyword[] = [
      { keyword: 'Python', found: false },
      { keyword: 'Docker', found: false },
      { keyword: 'REST APIs', found: false },
      { keyword: 'maintaining', found: false },
      { keyword: 'attention to detail', found: false },
    ];
    const cvText = 'Experienced with Python for backend development.';
    const classified = classifyAndVerifyKeywords(keywords, cvText);

    const python = classified.find((k) => k.keyword === 'Python');
    const maintaining = classified.find((k) => k.keyword === 'maintaining');
    const attentionToDetail = classified.find((k) => k.keyword === 'attention to detail');

    expect(python?.found).toBe(true);
    expect(maintaining?.category).toBe('GENERIC_OR_CONTEXTUAL');
    expect(maintaining?.weight).toBe(0);
    expect(attentionToDetail?.category).toBe('SOFT_SKILL');

    const score = computeAtsScore(classified);
    // Scorable weight: Python(3, matched) + Docker(3, missing) + REST
    // APIs(2, missing) + attention to detail(0.5, missing) = 8.5 total,
    // 3 matched -> ~35%. Meaningfully below "strong match" territory,
    // reflecting that 2 of 3 real technical requirements are missing.
    expect(score).toBeLessThan(50);
    expect(score).toBeGreaterThan(0);
  });

  // (D) Generic verbs alone must not dominate scoring.
  it('(D) a keyword list of only generic verbs does not produce a misleadingly punitive or inflated score', () => {
    const keywords: AtsKeyword[] = [
      { keyword: 'developing', found: false },
      { keyword: 'maintaining', found: false },
      { keyword: 'designing', found: false },
      { keyword: 'testing', found: false },
    ];
    const classified = classifyAndVerifyKeywords(keywords, 'Some CV text with no relevant terms.');
    expect(classified.every((k) => k.weight === 0)).toBe(true);
    expect(computeAtsScore(classified)).toBe(0);
  });

  // (E) Missing Docker should affect score more than missing communication.
  it('(E) missing a hard skill drags the score down substantially more than missing a soft skill', () => {
    const withMissingDocker = classifyAndVerifyKeywords(
      [
        { keyword: 'Docker', found: false },
        { keyword: 'communication', found: true },
      ],
      'Great communicator.',
    );
    const withMissingCommunication = classifyAndVerifyKeywords(
      [
        { keyword: 'Docker', found: true },
        { keyword: 'communication', found: false },
      ],
      'Containerized services with Docker.',
    );

    const scoreMissingDocker = computeAtsScore(withMissingDocker);
    const scoreMissingCommunication = computeAtsScore(withMissingCommunication);

    expect(scoreMissingDocker).toBeLessThan(scoreMissingCommunication);
  });

  // (F) A CV missing nearly all genuine hard skills must still score low.
  it('(F) a CV missing nearly all genuine hard skills receives a genuinely low ATS score', () => {
    const keywords: AtsKeyword[] = [
      { keyword: 'Python', found: false },
      { keyword: 'Java', found: false },
      { keyword: 'TypeScript', found: false },
      { keyword: 'REST APIs', found: false },
      { keyword: 'PostgreSQL', found: false },
      { keyword: 'Docker', found: false },
      { keyword: 'Redis', found: false },
      { keyword: 'CI/CD', found: false },
      { keyword: 'microservices', found: false },
      // Present, but low/no weight — must not rescue the score.
      { keyword: 'communication', found: true },
      { keyword: 'maintaining', found: true },
    ];
    const cvText = 'Excellent communicator responsible for maintaining internal documentation.';
    const classified = classifyAndVerifyKeywords(keywords, cvText);
    const score = computeAtsScore(classified);
    expect(score).toBeLessThan(15);
  });

  // (G) A CV with most genuine hard skills scores high even with different
  // generic verbs/wording.
  it('(G) a CV containing most genuine hard skills scores high despite differing generic verbs', () => {
    const keywords: AtsKeyword[] = [
      { keyword: 'Python', found: false },
      { keyword: 'PostgreSQL', found: false },
      { keyword: 'Docker', found: false },
      { keyword: 'REST APIs', found: false },
      { keyword: 'developing', found: false },
      { keyword: 'maintaining', found: false },
    ];
    const cvText =
      'Built and shipped backend services using Python, PostgreSQL, Docker, and REST APIs.';
    const classified = classifyAndVerifyKeywords(keywords, cvText);
    const score = computeAtsScore(classified);
    expect(score).toBeGreaterThanOrEqual(90);
  });

  it('returns 0 for an empty keyword list', () => {
    expect(computeAtsScore([])).toBe(0);
  });
});
