import { ConfigService } from '@nestjs/config';

import {
  PrefillExtractionService,
  SYSTEM_PROMPT,
  JSON_SCHEMA_HINT,
} from './prefill-extraction.service';

/**
 * RABBIT_NOTEBOOK.md §47 — regression coverage for the confirmed root
 * causes behind the "upload -> Use extracted details -> saved CV -> PDF"
 * data-loss bug: Qualities, References, and personalDetails.nationality
 * were never part of PrefillExtractionService's own JSON schema/prompt at
 * all (so ExtractionResponseSchema.parse() silently stripped them even if
 * a model somehow returned them), and the summary field, though
 * schema-supported, was reliably omitted by gpt-4o-mini for a repeated
 * source paragraph.
 *
 * These tests are entirely MOCKED (the real `openai` client is replaced
 * below, matching ai.service.spec.ts's own established pattern) — they
 * verify the DETERMINISTIC code path (Zod parsing + mapToContent) never
 * drops a field the model DID return, and defaults safely when it didn't.
 * They cannot and do not prove gpt-4o-mini will always include a summary
 * for a real, repeated-text CV — that was verified separately via ONE
 * real, paid, local-only (not production) gpt-4o-mini call against the
 * actual reported source PDF's real pdf-parse output, before and after
 * this fix's prompt change; see §47 for that evidence. No production
 * verification is claimed from this file.
 *
 * §48 extends this with two narrower, real-production-confirmed gaps in
 * the same territory: an education entry's `location` (schema-supported
 * since §47, but omitted by one real production call) and a reference's
 * `jobTitle`/`relationship` field attribution (one real call filed a
 * relationship word as `jobTitle` for one reference while correctly
 * splitting the other, in the same response) — see §48 for that evidence.
 */

const mockCreate = jest.fn();

jest.mock('openai', () =>
  jest.fn().mockImplementation(() => ({
    chat: { completions: { create: (...args: unknown[]) => mockCreate(...args) } },
  })),
);

const mockConfig = {
  getOrThrow: jest.fn(() => 'test-key'),
} as unknown as ConfigService;

function mockModelResponse(body: unknown, tokens = 500) {
  mockCreate.mockResolvedValue({
    choices: [{ message: { content: JSON.stringify(body) } }],
    usage: { total_tokens: tokens },
  });
}

describe('PrefillExtractionService', () => {
  beforeEach(() => {
    mockCreate.mockReset();
  });

  it('carries nationality, the summary, Qualities, and References through unchanged when the model returns them', async () => {
    mockModelResponse({
      personalDetails: {
        fullName: 'Alex Johnson',
        email: 'alex.johnson@university.ac.uk',
        nationality: 'Tanzanian',
      },
      summary: 'Motivated Computer Science graduate.',
      workExperience: [],
      education: [],
      skills: [],
      languages: [],
      certifications: [],
      qualities: ['Time management', 'Leadership'],
      references: [
        {
          fullName: 'Endrick Mollel',
          jobTitle: 'JKT',
          company: 'Sumangaya',
          relationship: 'Manager',
          email: 'endrickmollel34@gmail.com',
          phone: '0465739452',
        },
      ],
      referencesAvailableUponRequest: false,
    });

    const service = new PrefillExtractionService(mockConfig);
    const result = await service.extract('irrelevant for this mock');

    expect(result.content.personalDetails.nationality).toBe('Tanzanian');
    expect(result.content.summary).toBe('Motivated Computer Science graduate.');
    expect(result.content.qualities).toEqual(['Time management', 'Leadership']);
    expect(result.content.references).toHaveLength(1);
    expect(result.content.references?.[0]).toMatchObject({
      fullName: 'Endrick Mollel',
      jobTitle: 'JKT',
      company: 'Sumangaya',
      relationship: 'Manager',
      email: 'endrickmollel34@gmail.com',
      phone: '0465739452',
    });
    expect(result.content.references?.[0]?.id).toEqual(expect.any(String));
    expect(result.content.referencesAvailableUponRequest).toBe(false);
    expect(result.content.sectionOrder).toContain('references');
  });

  it("carries education entries' location through unchanged when the model returns it (§48)", async () => {
    mockModelResponse({
      personalDetails: { fullName: 'Alex Johnson', email: 'alex@example.com' },
      workExperience: [],
      education: [
        {
          institution: 'University of London',
          degree: 'BSc Computer Science',
          location: 'London, UK',
        },
        {
          institution: 'Marwadi University',
          degree: 'Diploma',
          location: 'Gujarat - India',
        },
      ],
      skills: [],
      languages: [],
      certifications: [],
    });

    const service = new PrefillExtractionService(mockConfig);
    const result = await service.extract('irrelevant for this mock');

    expect(result.content.education[0]?.location).toBe('London, UK');
    expect(result.content.education[1]?.location).toBe('Gujarat - India');
  });

  it('sets referencesAvailableUponRequest and leaves references empty when the model reports that case', async () => {
    mockModelResponse({
      personalDetails: { fullName: 'Alex Johnson', email: 'alex@example.com' },
      workExperience: [],
      education: [],
      skills: [],
      languages: [],
      certifications: [],
      referencesAvailableUponRequest: true,
    });

    const service = new PrefillExtractionService(mockConfig);
    const result = await service.extract('irrelevant for this mock');

    expect(result.content.referencesAvailableUponRequest).toBe(true);
    expect(result.content.references).toEqual([]);
  });

  it('defaults nationality/summary/Qualities/References safely (no throw) when the model omits them entirely', async () => {
    mockModelResponse({
      personalDetails: { fullName: 'Alex Johnson', email: 'alex@example.com' },
      workExperience: [],
      education: [],
      skills: [],
      languages: [],
      certifications: [],
    });

    const service = new PrefillExtractionService(mockConfig);
    const result = await service.extract('irrelevant for this mock');

    expect(result.content.personalDetails.nationality).toBeUndefined();
    expect(result.content.summary).toBeUndefined();
    expect(result.content.qualities).toEqual([]);
    expect(result.content.references).toEqual([]);
    expect(result.content.referencesAvailableUponRequest).toBe(false);
  });

  // Sentinel test — fails loudly if the anti-dedup/verbatim prompt wording
  // (the actual fix for the summary-omission and bullet-dedup/typo-
  // correction behaviour confirmed in §47) is ever silently reverted or
  // reworded away. Asserting on exact behaviour of a real model call isn't
  // possible in a mocked test, so this instead guards the INSTRUCTION that
  // produced the fix, the same "assert the exact value, not just that
  // something changed" standard this codebase already applies to CSS
  // formulas/constants elsewhere.
  it('still asks the model, verbatim, not to deduplicate/paraphrase/correct text or drop a repeated summary', () => {
    expect(SYSTEM_PROMPT).toMatch(/VERBATIM/);
    expect(SYSTEM_PROMPT).toMatch(/do not.*deduplicate/i);
    expect(SYSTEM_PROMPT).toMatch(/repetition is never a reason to omit/i);
  });

  // Sentinel for §48's two fixes — same guard-the-instruction rationale as
  // the test above.
  it('still asks the model to extract education location and to apply the reference relationship/jobTitle split consistently', () => {
    expect(SYSTEM_PROMPT).toMatch(/education entries whenever the CV shows one/i);
    expect(SYSTEM_PROMPT).toMatch(/never as jobTitle/i);
  });

  // Fix (RABBIT_NOTEBOOK.md §52): confirmed against a real production CV —
  // personalDetails.jobTitle (NOT a reference's own jobTitle field, guarded
  // above) was fabricated as "Computer Science Graduate" for a CV with no
  // job-title/headline line anywhere, by summarising the candidate's own
  // degree/self-description. Every downstream consumer (the CV builder,
  // Analysis, Tailoring) then treated this invented field as an established
  // fact. Sentinel guards the exact wording; the real behavioural fix (the
  // model now omitting jobTitle for this real CV) was verified separately
  // via one real, local-dev (not production) gpt-4o-mini call against the
  // actual retrieved CV text — see §52 for that evidence.
  it('(§52) still asks the model not to infer/construct personalDetails.jobTitle from the summary or degree', () => {
    expect(SYSTEM_PROMPT).toMatch(/personalDetails\.jobTitle/);
    expect(SYSTEM_PROMPT).toMatch(/never infer, construct, or summarise a title/i);
  });

  it('(§52) still carries an explicit personalDetails.jobTitle through unchanged when the model DOES find one explicitly stated', async () => {
    mockModelResponse({
      personalDetails: {
        fullName: 'Alex Johnson',
        email: 'alex@example.com',
        jobTitle: 'Senior Backend Engineer',
      },
      workExperience: [],
      education: [],
      skills: [],
      languages: [],
      certifications: [],
    });

    const service = new PrefillExtractionService(mockConfig);
    const result = await service.extract('irrelevant for this mock');

    // This fix only asks the model to stop INFERRING a title — it must not
    // regress the ordinary case of a CV that genuinely states one.
    expect(result.content.personalDetails.jobTitle).toBe('Senior Backend Engineer');
  });

  // Fix (RABBIT_NOTEBOOK.md §53): confirmed against a real production CV —
  // an education entry whose source text gave only years ("2021 - 2024",
  // no month anywhere) came back from the model as "2021-01"/"2024-01", a
  // fabricated month. Root cause was JSON_SCHEMA_HINT's own literal
  // "YYYY-MM" type example overriding this prompt's looser "YYYY if only
  // the year is known" prose rule. Reproduced and confirmed fixed with a
  // real gpt-4o-mini call against synthetic CV text carrying the same
  // shape (year-only education, explicit-month work experience) — see §53.
  // Sentinel guards the exact wording of the new rule.
  it('(§53) still asks the model never to invent a month to force a year-only date into YYYY-MM', () => {
    expect(SYSTEM_PROMPT).toMatch(/never invent, guess, or default a month/i);
    expect(JSON_SCHEMA_HINT).toMatch(/YYYY-MM or YYYY/);
  });

  it('(§53) carries a year-only education date through unchanged (does not pad in a fabricated month)', async () => {
    mockModelResponse({
      personalDetails: { fullName: 'Alex Johnson', email: 'alex@example.com' },
      workExperience: [],
      education: [
        {
          institution: 'Riverside College',
          degree: 'Diploma in Information Technology',
          startDate: '2021',
          endDate: '2024',
        },
      ],
      skills: [],
      languages: [],
      certifications: [],
    });

    const service = new PrefillExtractionService(mockConfig);
    const result = await service.extract('irrelevant for this mock');

    expect(result.content.education[0]?.startDate).toBe('2021');
    expect(result.content.education[0]?.endDate).toBe('2024');
  });

  it('(§53) still carries a genuine month/year work-experience date through unchanged', async () => {
    mockModelResponse({
      personalDetails: { fullName: 'Alex Johnson', email: 'alex@example.com' },
      workExperience: [
        {
          company: 'Initech Ltd',
          title: 'Support Technician',
          startDate: '2024-10',
          endDate: '2025-09',
          current: false,
          bullets: [],
        },
      ],
      education: [],
      skills: [],
      languages: [],
      certifications: [],
    });

    const service = new PrefillExtractionService(mockConfig);
    const result = await service.extract('irrelevant for this mock');

    expect(result.content.workExperience[0]?.startDate).toBe('2024-10');
    expect(result.content.workExperience[0]?.endDate).toBe('2025-09');
  });

  // Fix (RABBIT_NOTEBOOK.md §54): confirmed against a real production CV —
  // a "6.0 PROJECTS" section ("Muniverse Application; Campus social media
  // app.") was present in the raw parsed text but had nowhere to go, since
  // CvContent had no `projects` field/prompt/schema support at all — the
  // same class of gap §47 already fixed once for Qualities/References.
  it('(§54) still asks the model to extract a Projects section without inventing technologies, contributions, or achievements', () => {
    expect(SYSTEM_PROMPT).toMatch(/extract a "Projects" section/i);
    expect(SYSTEM_PROMPT).toMatch(/never invent a technology, contribution, achievement, or date/i);
  });

  it('(§54) carries a project through unchanged when the model returns one', async () => {
    mockModelResponse({
      personalDetails: { fullName: 'Alex Johnson', email: 'alex@example.com' },
      workExperience: [],
      projects: [
        {
          title: 'Muniverse Application',
          link: 'github.com/example/muniverse',
          startDate: '2023',
          endDate: '2024',
          bullets: ['Campus social media app.'],
        },
      ],
      education: [],
      skills: [],
      languages: [],
      certifications: [],
    });

    const service = new PrefillExtractionService(mockConfig);
    const result = await service.extract('irrelevant for this mock');

    expect(result.content.projects).toHaveLength(1);
    expect(result.content.projects?.[0]).toMatchObject({
      title: 'Muniverse Application',
      link: 'github.com/example/muniverse',
      startDate: '2023',
      endDate: '2024',
      bullets: ['Campus social media app.'],
    });
    expect(result.content.projects?.[0]?.id).toEqual(expect.any(String));
    expect(result.content.sectionOrder).toContain('projects');
  });

  it('(§54) defaults projects safely (no throw) when the model omits the section entirely', async () => {
    mockModelResponse({
      personalDetails: { fullName: 'Alex Johnson', email: 'alex@example.com' },
      workExperience: [],
      education: [],
      skills: [],
      languages: [],
      certifications: [],
    });

    const service = new PrefillExtractionService(mockConfig);
    const result = await service.extract('irrelevant for this mock');

    expect(result.content.projects).toEqual([]);
  });
});
