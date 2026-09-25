import { ConfigService } from '@nestjs/config';

import { PrefillExtractionService, SYSTEM_PROMPT } from './prefill-extraction.service';

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
});
