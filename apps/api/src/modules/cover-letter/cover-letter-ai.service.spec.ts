import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';

import { CoverLetterAiService, describeError } from './cover-letter-ai.service';
import type { CvEvidence } from './cv-evidence.util';

// openai and @anthropic-ai/sdk are real HTTP clients constructed directly in
// CoverLetterAiService's constructor — mocked here so tests never make
// network calls. Both packages export their client as a plain callable (no
// __esModule marker), so a bare jest.fn() constructor mock matches their
// real shape under esModuleInterop.
const mockOpenAICreate = jest.fn();
const mockAnthropicCreate = jest.fn();

jest.mock('openai', () =>
  jest.fn().mockImplementation(() => ({
    chat: { completions: { create: (...args: unknown[]) => mockOpenAICreate(...args) } },
  })),
);

jest.mock('@anthropic-ai/sdk', () =>
  jest.fn().mockImplementation(() => ({
    messages: { create: (...args: unknown[]) => mockAnthropicCreate(...args) },
  })),
);

// ANTHROPIC_API_KEY is resolved via ConfigService.get() (never getOrThrow —
// see optional-api-key.util.ts), so the mock must implement both methods:
// getOrThrow for the required OPENAI_API_KEY, get for the optional one.
const mockConfig = {
  getOrThrow: jest.fn((key: string) => {
    const vals: Record<string, string> = { OPENAI_API_KEY: 'test-key' };
    return vals[key] ?? '';
  }),
  get: jest.fn((key: string) => {
    const vals: Record<string, string> = { ANTHROPIC_API_KEY: 'test-key' };
    return vals[key];
  }),
};

function buildService(anthropicKeyValue: string | undefined): CoverLetterAiService {
  const config = {
    getOrThrow: mockConfig.getOrThrow,
    get: jest.fn((key: string) => (key === 'ANTHROPIC_API_KEY' ? anthropicKeyValue : undefined)),
  };
  return new CoverLetterAiService(config as unknown as ConfigService);
}

// The exact regression scenario: a CV that establishes none of Python, Java,
// TypeScript, REST APIs, PostgreSQL/MySQL, Git, Docker, CI/CD, cloud
// experience, scalable-system design, or database-query optimization.
const NO_TECH_CV_TEXT =
  'Recent Computer Science graduate with academic coursework in algorithms and data structures. ' +
  'Completed a university group project building a simple inventory tracking spreadsheet tool. ' +
  'Strong communicator, quick learner, and comfortable working in fast-paced team environments. ' +
  'Part-time role as a retail assistant, handling customer queries and basic stock management.';

const TECH_CV_TEXT =
  'Software engineer with 3 years of experience building web applications in TypeScript and ' +
  'JavaScript. Strong communicator with a BSc in Computer Science.';

const JOB_DESCRIPTION =
  'We need a backend engineer proficient in Python, Java, REST APIs, PostgreSQL or MySQL, Git, ' +
  'Docker, CI/CD pipelines, cloud platforms, scalable system design, and database query optimization.';

const TONES = ['professional', 'formal', 'enthusiastic', 'conversational'] as const;

function openAiResponse(text: string, tokens = 300) {
  return {
    choices: [{ message: { content: text } }],
    usage: { total_tokens: tokens },
  };
}

function anthropicResponse(text: string, inputTokens = 100, outputTokens = 100) {
  return {
    content: [{ type: 'text', text }],
    usage: { input_tokens: inputTokens, output_tokens: outputTokens },
  };
}

// A clean, always-valid letter body (long enough, no brackets, mentions
// company/title, mentions only genuinely-supported experience). Deliberately
// avoids any soft-skill/possession phrasing not established by NO_TECH_CV_TEXT
// (e.g. "problem-solving," "attention to detail") — those are exactly what
// the V2 soft-skill guard now catches, so this fixture must stay genuinely
// clean rather than relying on any of the checked terms.
function cleanLetter(companyName: string, jobTitle: string): string {
  return (
    `Dear Hiring Manager,\n\nI am writing to apply for the ${jobTitle} position at ${companyName}. ` +
    'My academic background in Computer Science, combined with hands-on project work building an ' +
    'inventory tracking tool, has given me a solid foundation to build on. In my retail role I ' +
    'regularly balanced competing priorities while handling customer queries.\n\nI would welcome the ' +
    `chance to bring this mindset to ${companyName} and grow alongside the team. Thank you for your ` +
    'consideration.\n\nSincerely'
  );
}

const HALLUCINATED_LETTERS: Record<
  (typeof TONES)[number],
  (companyName: string, jobTitle: string) => string
> = {
  professional: (companyName: string, jobTitle: string) =>
    `Dear Hiring Manager,\n\nI am excited to apply for the ${jobTitle} role at ${companyName}. ` +
    'I am well-versed in Git and Docker, and I have strong Python proficiency built up over several ' +
    `projects.\n\nI look forward to contributing to ${companyName}. Sincerely`,
  formal: (companyName: string, jobTitle: string) =>
    `Dear Hiring Manager,\n\nI wish to apply for the ${jobTitle} position at ${companyName}. ` +
    'I have extensive experience with cloud platforms and database query optimization from my prior ' +
    `work.\n\nYours faithfully, regarding the ${companyName} opportunity.`,
  enthusiastic: (companyName: string, jobTitle: string) =>
    `Dear Hiring Manager,\n\nI would love to join ${companyName} as a ${jobTitle}! ` +
    'I have strong experience designing scalable systems and optimizing database queries, and I ' +
    `can't wait to bring that energy to ${companyName}. Sincerely`,
  conversational: (companyName: string, jobTitle: string) =>
    `Hi there,\n\nI'd love to be considered for the ${jobTitle} role at ${companyName}. ` +
    "I've got a solid foundation in scalable REST APIs and I have experience optimizing database " +
    `queries from past work.\n\nThanks for considering me for ${companyName}!`,
};

describe('CoverLetterAiService', () => {
  let service: CoverLetterAiService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [CoverLetterAiService, { provide: ConfigService, useValue: mockConfig }],
    }).compile();

    service = module.get<CoverLetterAiService>(CoverLetterAiService);
  });

  // ─── Regression: none of the four tones may convert JD tech into claims ───

  it.each(TONES)(
    'rejects a hallucinated %s-tone letter that claims unsupported job-description technologies',
    async (tone) => {
      const badLetter = HALLUCINATED_LETTERS[tone]('Acme Corp', 'Backend Engineer');
      mockOpenAICreate.mockResolvedValue(openAiResponse(badLetter));
      mockAnthropicCreate.mockResolvedValue(anthropicResponse(badLetter));

      await expect(
        service.generateCoverLetter(
          NO_TECH_CV_TEXT,
          JOB_DESCRIPTION,
          'Backend Engineer',
          'Acme Corp',
          tone,
        ),
        // Diagnostic-loss fix: the final thrown error must carry the real
        // last-attempt reason (here, the possession-claim guard's own
        // message), not just the old generic "all AI providers exhausted".
      ).rejects.toThrow(/Cover letter generation failed after retries: .*claims possession of/);

      // Both providers were tried and both were rejected — grounding is
      // enforced identically regardless of which provider answered.
      expect(mockOpenAICreate).toHaveBeenCalledTimes(3);
      expect(mockAnthropicCreate).toHaveBeenCalledTimes(3);
    },
  );

  it('recovers via the Anthropic fallback when OpenAI hallucinates but Anthropic answers cleanly', async () => {
    const badLetter = HALLUCINATED_LETTERS.professional('Acme Corp', 'Backend Engineer');
    const goodLetter = cleanLetter('Acme Corp', 'Backend Engineer');
    mockOpenAICreate.mockResolvedValue(openAiResponse(badLetter));
    mockAnthropicCreate.mockResolvedValue(anthropicResponse(goodLetter));

    const result = await service.generateCoverLetter(
      NO_TECH_CV_TEXT,
      JOB_DESCRIPTION,
      'Backend Engineer',
      'Acme Corp',
      'professional',
    );

    expect(result.content).toBe(goodLetter);
    expect(result.modelUsed).toBe('claude-3-5-sonnet-20241022');
    expect(mockOpenAICreate).toHaveBeenCalledTimes(3);
    expect(mockAnthropicCreate).toHaveBeenCalledTimes(1);
  });

  // ─── Aspirational language must remain valid ───────────────────────────────

  it('accepts a letter that expresses genuine interest in an unsupported technology', async () => {
    const letter =
      `Dear Hiring Manager,\n\nI am applying for the Backend Engineer role at Acme Corp. ` +
      'My academic project work and retail experience have taught me to solve problems methodically ' +
      'under pressure. I am interested in expanding my Docker knowledge and am eager to develop ' +
      'further experience with cloud platforms as I grow into this kind of role.\n\n' +
      'I would welcome the opportunity to bring my drive to Acme Corp. Sincerely';
    mockOpenAICreate.mockResolvedValue(openAiResponse(letter));

    const result = await service.generateCoverLetter(
      NO_TECH_CV_TEXT,
      JOB_DESCRIPTION,
      'Backend Engineer',
      'Acme Corp',
      'enthusiastic',
    );

    expect(result.content).toBe(letter);
    expect(mockOpenAICreate).toHaveBeenCalledTimes(1); // no retry needed
    expect(mockAnthropicCreate).not.toHaveBeenCalled();
  });

  // ─── Genuinely supported skills can still be confidently claimed ───────────

  it('accepts a possession claim about a skill genuinely supported by the CV', async () => {
    const letter =
      'Dear Hiring Manager,\n\nI am writing to apply for the Frontend Engineer role at Acme Corp. ' +
      'I am proficient in TypeScript and JavaScript, having spent three years building production ' +
      'web applications with both.\n\nI look forward to bringing this experience to Acme Corp. ' +
      'Sincerely';
    mockOpenAICreate.mockResolvedValue(openAiResponse(letter));

    const result = await service.generateCoverLetter(
      TECH_CV_TEXT,
      'We need a frontend engineer skilled in TypeScript.',
      'Frontend Engineer',
      'Acme Corp',
      'professional',
    );

    expect(result.content).toBe(letter);
    expect(mockAnthropicCreate).not.toHaveBeenCalled();
  });

  // ─── V2: skill-list evidence supports knowledge claims, not experience ─────

  it('accepts a modest knowledge claim about a skill supplied only via the structured skills-only evidence', async () => {
    // NO_TECH_CV_TEXT never mentions Docker — this only passes validation
    // because 'Docker' is supplied as skills-only evidence, and the letter's
    // phrasing ("I have knowledge of") is a modest knowledge claim, which a
    // skills-list entry alone is sufficient to ground — proving the evidence
    // object is actually wired into the guard (not just into the prompt).
    // Kept as two separate sentences deliberately: the guard operates at
    // sentence granularity, so a single run-on sentence combining this
    // knowledge claim with an unrelated experience-pattern phrase (e.g.
    // "...and a strong foundation...") would have the stricter tier apply
    // to the whole sentence — a known, accepted limitation (see
    // possession-claim-guard.util.ts's header comment).
    const letter =
      'Dear Hiring Manager,\n\nI am writing to apply for the Backend Engineer role at Acme Corp. ' +
      'I have knowledge of Docker. My academic background gives me a foundation to build on.' +
      '\n\nI look forward to bringing this experience to Acme Corp. Sincerely';
    mockOpenAICreate.mockResolvedValue(openAiResponse(letter));

    const result = await service.generateCoverLetter(
      NO_TECH_CV_TEXT,
      'We need a backend engineer skilled in Docker.',
      'Backend Engineer',
      'Acme Corp',
      'professional',
      { experienceText: '', skillsOnlyTerms: ['Docker'] },
    );

    expect(result.content).toBe(letter);
    expect(mockAnthropicCreate).not.toHaveBeenCalled();
  });

  it('still rejects an experience-level claim about a skill that is only listed, never demonstrated (skill → experience inflation)', async () => {
    // Regression for the exact production QA finding: a skills-list-only
    // term (Docker) must not ground a *stronger* claim like "well-versed
    // in" — that requires actual work-experience evidence, not just a
    // skill tag, even when the term is supplied as evidence at all.
    const badLetter =
      'Dear Hiring Manager,\n\nI am writing to apply for the Backend Engineer role at Acme Corp. ' +
      'I am well-versed in Docker from my professional work.' +
      '\n\nI look forward to bringing this experience to Acme Corp. Sincerely';
    mockOpenAICreate.mockResolvedValue(openAiResponse(badLetter));
    mockAnthropicCreate.mockResolvedValue(anthropicResponse(badLetter));

    await expect(
      service.generateCoverLetter(
        NO_TECH_CV_TEXT,
        'We need a backend engineer skilled in Docker.',
        'Backend Engineer',
        'Acme Corp',
        'professional',
        { experienceText: '', skillsOnlyTerms: ['Docker'] },
      ),
    ).rejects.toThrow('Cover letter generation failed after retries');
  });

  // ─── Tone descriptors must be distinct ─────────────────────────────────────

  it('sends a distinct tone descriptor for each of the four tones', async () => {
    const prompts: string[] = [];

    for (const tone of TONES) {
      mockOpenAICreate.mockResolvedValueOnce(
        openAiResponse(cleanLetter('Acme Corp', 'Backend Engineer')),
      );
      await service.generateCoverLetter(
        NO_TECH_CV_TEXT,
        JOB_DESCRIPTION,
        'Backend Engineer',
        'Acme Corp',
        tone,
      );
      const call = mockOpenAICreate.mock.calls[mockOpenAICreate.mock.calls.length - 1] as [
        { messages: { role: string; content: string }[] },
      ];
      prompts.push(call[0].messages[1]!.content);
    }

    expect(prompts[0]).toMatch(/Tone: Professional/);
    expect(prompts[1]).toMatch(/Tone: Formal/);
    expect(prompts[2]).toMatch(/Tone: Enthusiastic/);
    expect(prompts[3]).toMatch(/Tone: Conversational/);

    // All four prompts must be pairwise distinct.
    expect(new Set(prompts).size).toBe(prompts.length);
  });

  // (E) Tone differentiation: each tone contract must specify concretely
  // different sentence-rhythm/structure/warmth instructions — not just a
  // different label — so the model cannot satisfy all four with the same
  // underlying structure and a swapped adjective (the exact production QA
  // finding: tones differed only via "I am writing" vs "I am excited").
  it('(E) gives each tone a distinct, substantive contract covering contractions, rhythm, and closing style', async () => {
    const prompts: Record<(typeof TONES)[number], string> = {} as never;

    for (const tone of TONES) {
      mockOpenAICreate.mockResolvedValueOnce(
        openAiResponse(cleanLetter('Acme Corp', 'Backend Engineer')),
      );
      await service.generateCoverLetter(
        NO_TECH_CV_TEXT,
        JOB_DESCRIPTION,
        'Backend Engineer',
        'Acme Corp',
        tone,
      );
      const call = mockOpenAICreate.mock.calls[mockOpenAICreate.mock.calls.length - 1] as [
        { messages: { role: string; content: string }[] },
      ];
      prompts[tone] = call[0].messages[1]!.content;
    }

    // Formal: explicitly bans contractions and caps emotional intensity.
    expect(prompts.formal).toMatch(/avoid contractions/i);
    expect(prompts.formal).toMatch(/no exclamation marks/i);

    // Enthusiastic: explicitly allows contractions and bounds exclamation use.
    expect(prompts.enthusiastic).toMatch(/contractions are welcome/i);
    expect(prompts.enthusiastic).toMatch(/one exclamation mark/i);

    // Conversational: explicitly expects contractions throughout.
    expect(prompts.conversational).toMatch(/contractions are expected/i);

    // Professional: sits between the two, sparing rather than banned/expected.
    expect(prompts.professional).toMatch(/contractions are acceptable but used sparingly/i);

    // Each tone specifies its own opening and closing behavior distinctly.
    expect(prompts.formal).toMatch(/measured statement of purpose/i);
    expect(prompts.conversational).toMatch(/direct, human way/i);
  });

  // Grounding rules (Task 3) must actually reach the model as part of the
  // system prompt, not just live in code comments.
  it('sends the evidence-type and soft-skill grounding rules in the system prompt', async () => {
    mockOpenAICreate.mockResolvedValue(
      openAiResponse(cleanLetter('Acme Corp', 'Backend Engineer')),
    );

    await service.generateCoverLetter(
      NO_TECH_CV_TEXT,
      JOB_DESCRIPTION,
      'Backend Engineer',
      'Acme Corp',
      'professional',
    );

    const call = mockOpenAICreate.mock.calls[0] as [
      { messages: { role: string; content: string }[] },
    ];
    const systemPrompt = call[0].messages[0]!.content;

    expect(systemPrompt).toMatch(
      /never convert a listed skill into a claim of professional\/work experience/i,
    );
    expect(systemPrompt).toMatch(/never infer a soft skill, team methodology/i);
    expect(systemPrompt).toMatch(/frame it as genuine interest or willingness to grow/i);
    expect(systemPrompt).toMatch(/dynamic and innovative environment/i); // boilerplate example listed
  });

  // (I) Job-title validation investigation: the prompt's prior wording
  // ("mention the job title naturally") did not require the model to
  // reproduce the exact given string, which — combined with the tone
  // contracts' encouragement to vary sentence structure — plausibly let a
  // compound title like "Backend Software Engineer" get paraphrased into
  // something validateOutput()'s exact-substring check would reject. This
  // asserts the strengthened instruction actually reaches the model.
  it('(I) instructs the model to include the exact given job title verbatim', async () => {
    mockOpenAICreate.mockResolvedValue(
      openAiResponse(cleanLetter('Acme Corp', 'Backend Software Engineer')),
    );

    await service.generateCoverLetter(
      NO_TECH_CV_TEXT,
      JOB_DESCRIPTION,
      'Backend Software Engineer',
      'Acme Corp',
      'professional',
    );

    const call = mockOpenAICreate.mock.calls[0] as [
      { messages: { role: string; content: string }[] },
    ];
    const userPrompt = call[0].messages[1]!.content;

    expect(userPrompt).toMatch(/verbatim at least once/i);
    expect(userPrompt).toContain('"Backend Software Engineer"');
  });

  // ─── Existing happy path is preserved ──────────────────────────────────────

  it('returns a clean letter on the first attempt with no retries (happy path)', async () => {
    const letter = cleanLetter('Acme Corp', 'Backend Engineer');
    mockOpenAICreate.mockResolvedValue(openAiResponse(letter, 420));

    const result = await service.generateCoverLetter(
      NO_TECH_CV_TEXT,
      JOB_DESCRIPTION,
      'Backend Engineer',
      'Acme Corp',
      'professional',
    );

    expect(result.content).toBe(letter);
    expect(result.modelUsed).toBe('gpt-4o');
    expect(result.tokensUsed).toBe(420);
    expect(mockOpenAICreate).toHaveBeenCalledTimes(1);
    expect(mockAnthropicCreate).not.toHaveBeenCalled();
  });

  it('still rejects and retries on the pre-existing validations (e.g. missing company name)', async () => {
    mockOpenAICreate.mockResolvedValue(
      openAiResponse('A letter that never mentions the employer at all, only the role title.'),
    );
    mockAnthropicCreate.mockResolvedValue(
      anthropicResponse('A letter that never mentions the employer at all, only the role title.'),
    );

    await expect(
      service.generateCoverLetter(
        NO_TECH_CV_TEXT,
        JOB_DESCRIPTION,
        'the role title',
        'Acme Corp',
        'professional',
      ),
      // Diagnostic-loss fix: the real validateOutput() rejection reason
      // (too short, since this fixture is well under 200 chars) must
      // survive into the final error rather than a generic message.
    ).rejects.toThrow(/Cover letter generation failed after retries: .*too short/);
  });

  // ─── Anthropic is a genuinely optional fallback ────────────────────────────

  describe('optional Anthropic fallback', () => {
    it('fails cleanly after OpenAI is exhausted when ANTHROPIC_API_KEY is unset — never calls Anthropic', async () => {
      const noAnthropicService = buildService(undefined);
      mockOpenAICreate.mockResolvedValue(openAiResponse('too short'));

      await expect(
        noAnthropicService.generateCoverLetter(
          NO_TECH_CV_TEXT,
          JOB_DESCRIPTION,
          'Backend Engineer',
          'Acme Corp',
          'professional',
        ),
        // Diagnostic-loss fix: real reason (too-short output) preserved.
      ).rejects.toThrow(/Cover letter generation failed after retries: .*too short/);

      expect(mockOpenAICreate).toHaveBeenCalledTimes(3);
      expect(mockAnthropicCreate).not.toHaveBeenCalled();
    });

    it('fails cleanly and never calls Anthropic when ANTHROPIC_API_KEY is an obvious placeholder value', async () => {
      const placeholderService = buildService('sk-ant-placeholder-dev-only');
      mockOpenAICreate.mockResolvedValue(openAiResponse('too short'));

      await expect(
        placeholderService.generateCoverLetter(
          NO_TECH_CV_TEXT,
          JOB_DESCRIPTION,
          'Backend Engineer',
          'Acme Corp',
          'professional',
        ),
      ).rejects.toThrow('Cover letter generation failed after retries');

      expect(mockOpenAICreate).toHaveBeenCalledTimes(3);
      expect(mockAnthropicCreate).not.toHaveBeenCalled();
    });

    it('still falls back to Anthropic when a real key is configured (unaffected by the optionality change)', async () => {
      const configuredService = buildService('sk-ant-real-key');
      const badLetter = HALLUCINATED_LETTERS.professional('Acme Corp', 'Backend Engineer');
      const goodLetter = cleanLetter('Acme Corp', 'Backend Engineer');
      mockOpenAICreate.mockResolvedValue(openAiResponse(badLetter));
      mockAnthropicCreate.mockResolvedValue(anthropicResponse(goodLetter));

      const result = await configuredService.generateCoverLetter(
        NO_TECH_CV_TEXT,
        JOB_DESCRIPTION,
        'Backend Engineer',
        'Acme Corp',
        'professional',
      );

      expect(result.content).toBe(goodLetter);
      expect(mockAnthropicCreate).toHaveBeenCalledTimes(1);
    });

    it('OpenAI-only happy path is unaffected regardless of Anthropic configuration', async () => {
      const noAnthropicService = buildService(undefined);
      const letter = cleanLetter('Acme Corp', 'Backend Engineer');
      mockOpenAICreate.mockResolvedValue(openAiResponse(letter, 420));

      const result = await noAnthropicService.generateCoverLetter(
        NO_TECH_CV_TEXT,
        JOB_DESCRIPTION,
        'Backend Engineer',
        'Acme Corp',
        'professional',
      );

      expect(result.content).toBe(letter);
      expect(result.modelUsed).toBe('gpt-4o');
      expect(mockAnthropicCreate).not.toHaveBeenCalled();
    });
  });

  // ─── Diagnostic-loss fix: real failure reason must reach the final error ──
  describe('final error preserves the real diagnostic reason', () => {
    it('preserves the last OpenAI attempt error when Anthropic is not configured', async () => {
      const noAnthropicService = buildService(undefined);
      mockOpenAICreate.mockRejectedValue(new Error('Rate limit reached for gpt-4o'));

      await expect(
        noAnthropicService.generateCoverLetter(
          NO_TECH_CV_TEXT,
          JOB_DESCRIPTION,
          'Backend Engineer',
          'Acme Corp',
          'professional',
        ),
      ).rejects.toThrow(
        'Cover letter generation failed after retries: Error: Rate limit reached for gpt-4o',
      );
    });

    it('preserves the last Anthropic attempt error once OpenAI is also exhausted', async () => {
      const configuredService = buildService('sk-ant-real-key');
      mockOpenAICreate.mockRejectedValue(new Error('OpenAI request timed out'));
      mockAnthropicCreate.mockRejectedValue(new Error('Anthropic overloaded_error'));

      await expect(
        configuredService.generateCoverLetter(
          NO_TECH_CV_TEXT,
          JOB_DESCRIPTION,
          'Backend Engineer',
          'Acme Corp',
          'professional',
        ),
        // The Anthropic attempt is the LAST one tried, so its error — not
        // OpenAI's earlier one — must be what survives into the final message.
      ).rejects.toThrow(
        'Cover letter generation failed after retries: Error: Anthropic overloaded_error',
      );
    });

    it('never includes the CV text, job description, or prompt content in the final error message', async () => {
      const secretCvText = 'CONFIDENTIAL: candidate lives at 42 Secret Lane and earns $999,999.';
      const secretJobDescription = 'INTERNAL-ONLY requisition code XJ-42, do not disclose'.padEnd(
        60,
        '.',
      );
      mockOpenAICreate.mockRejectedValue(new Error('network error'));
      mockAnthropicCreate.mockRejectedValue(new Error('network error'));

      let thrown: Error | undefined;
      try {
        await service.generateCoverLetter(
          secretCvText,
          secretJobDescription,
          'Backend Engineer',
          'Acme Corp',
          'professional',
        );
      } catch (err) {
        thrown = err as Error;
      }

      expect(thrown).toBeDefined();
      expect(thrown!.message).not.toContain('Secret Lane');
      expect(thrown!.message).not.toContain('XJ-42');
      expect(thrown!.message).toBe(
        'Cover letter generation failed after retries: Error: network error',
      );
    });

    // Privacy-safe logging: a possession-claim (grounding) rejection's own
    // Error is what ultimately reaches Railway via describeError() — it
    // must keep the unsupported term (the actual diagnostic signal) but
    // must NOT embed the full generated sentence the guard quoted it from.
    it('preserves the unsupported term but strips the generated sentence from a possession-claim rejection', async () => {
      const badLetter = HALLUCINATED_LETTERS.professional('Acme Corp', 'Backend Engineer');
      mockOpenAICreate.mockResolvedValue(openAiResponse(badLetter));
      mockAnthropicCreate.mockResolvedValue(anthropicResponse(badLetter));

      let thrown: Error | undefined;
      try {
        await service.generateCoverLetter(
          NO_TECH_CV_TEXT,
          JOB_DESCRIPTION,
          'Backend Engineer',
          'Acme Corp',
          'professional',
        );
      } catch (err) {
        thrown = err as Error;
      }

      expect(thrown).toBeDefined();
      // The reason/category and the unsupported term survive...
      expect(thrown!.message).toContain(
        'claims possession of technology/skill not supported by the CV',
      );
      expect(thrown!.message).toMatch(/"(git|docker|python)"/);
      // ...but the full generated sentence the term was found in does not.
      expect(thrown!.message).not.toContain(' in: ');
      expect(thrown!.message).not.toContain(badLetter);
      expect(thrown!.message).not.toContain('I am excited to apply for the Backend Engineer role');
    });
  });

  describe('describeError', () => {
    it('renders an Error as "Name: message"', () => {
      expect(describeError(new Error('boom'))).toBe('Error: boom');
    });

    it('renders a plain string as-is', () => {
      expect(describeError('plain string failure')).toBe('plain string failure');
    });

    it('falls back to a safe label for a non-Error, non-string throw', () => {
      expect(describeError({ weird: true })).toBe('Unknown error');
      expect(describeError(undefined)).toBe('Unknown error');
    });
  });

  // ─── Reliability fix: repair-aware retries ─────────────────────────────────
  // Production Railway evidence: OpenAI calls succeed, but the SAME kind of
  // over-claiming phrasing (python, java, rest api, postgresql, mysql, git,
  // docker, ci/cd, cloud platforms, database design, authentication) gets
  // regenerated blind on every retry with no knowledge of what was rejected,
  // exhausting all attempts even though a corrected draft would pass.
  describe('repair-aware retries', () => {
    type ChatMessage = { role: string; content: string };
    function messagesFromCall(call: unknown): ChatMessage[] {
      return (call as [{ messages: ChatMessage[] }])[0].messages;
    }

    // Mirrors the exact production failure set: technologies genuinely
    // listed as skills only, never demonstrated in a work bullet.
    const PRODUCTION_SKILL_EVIDENCE: CvEvidence = {
      experienceText:
        'Acme Tanzania — Junior Developer. Built and maintained internal tooling, fixed bugs ' +
        'reported by users, and wrote unit tests for existing services.',
      skillsOnlyTerms: [
        'Python',
        'Java',
        'REST APIs',
        'PostgreSQL',
        'MySQL',
        'Git',
        'Docker',
        'CI/CD',
        'Cloud platforms',
        'Database design',
      ],
    };

    const overclaimingLetter = (companyName: string, jobTitle: string) =>
      `Dear Hiring Manager,\n\nI am writing to apply for the ${jobTitle} role at ${companyName}. ` +
      'I have extensive hands-on experience with Python and Java, and I have led production ' +
      `PostgreSQL and MySQL deployments using Git and Docker.\n\nSincerely, contributing to ${companyName}.`;

    // ─── (5)/(6): repair feedback reaches attempt 2, safely ────────────────

    it('sends attempt 2 a private repair instruction naming only the rejected terms, absent from attempt 1', async () => {
      const badLetter = overclaimingLetter('Acme Corp', 'Backend Engineer');
      const goodLetter = cleanLetter('Acme Corp', 'Backend Engineer');
      mockOpenAICreate
        .mockResolvedValueOnce(openAiResponse(badLetter))
        .mockResolvedValueOnce(openAiResponse(goodLetter));

      const result = await service.generateCoverLetter(
        NO_TECH_CV_TEXT,
        JOB_DESCRIPTION,
        'Backend Engineer',
        'Acme Corp',
        'professional',
        PRODUCTION_SKILL_EVIDENCE,
      );

      expect(result.content).toBe(goodLetter);
      // (7) The repaired attempt succeeded — no need to exhaust all 3.
      expect(mockOpenAICreate).toHaveBeenCalledTimes(2);

      const firstMessages = messagesFromCall(mockOpenAICreate.mock.calls[0]);
      const secondMessages = messagesFromCall(mockOpenAICreate.mock.calls[1]);

      // Attempt 1 carries no repair note — nothing to repair yet.
      expect(firstMessages).toHaveLength(2);
      expect(firstMessages.every((m) => m.role !== 'system' || m.content.length > 0)).toBe(true);

      // Attempt 2 carries an extra system message with the repair instruction.
      expect(secondMessages).toHaveLength(3);
      const repairMessage = secondMessages[1]!;
      expect(repairMessage.role).toBe('system');

      // (6) Only the unsupported term names appear — never the CV, the job
      // description, the previous draft, or any excerpt of its wording.
      expect(repairMessage.content).toContain('python');
      expect(repairMessage.content).toContain('java');
      expect(repairMessage.content).toContain('postgresql');
      expect(repairMessage.content).toContain('mysql');
      expect(repairMessage.content).toContain('git');
      expect(repairMessage.content).toContain('docker');
      expect(repairMessage.content).not.toContain(NO_TECH_CV_TEXT);
      expect(repairMessage.content).not.toContain(JOB_DESCRIPTION);
      expect(repairMessage.content).not.toContain(badLetter);
      expect(repairMessage.content).not.toContain('extensive hands-on experience');
    });

    // Accumulation fix: a fresh grounding rejection must ADD to the repair
    // feedback, never REPLACE it — otherwise an earlier attempt's flagged
    // term could legitimately reappear in a later draft once it's no
    // longer mentioned in the (now stale, replaced) feedback.
    it('accumulates unsupported terms across grounding failures — attempt 3 still names attempt 1s terms, not only attempt 2s new one', async () => {
      // Anthropic is not configured in production — this test uses the
      // OpenAI-only path to match that reality (see the module report).
      const noAnthropicService = buildService(undefined);

      const pythonDockerLetter = (companyName: string, jobTitle: string) =>
        `Dear Hiring Manager,\n\nI am writing to apply for the ${jobTitle} role at ${companyName}. ` +
        'I have extensive hands-on experience with Python and Docker from several academic and ' +
        `personal projects.\n\nSincerely, contributing to ${companyName}.`;
      const postgresqlLetter = (companyName: string, jobTitle: string) =>
        `Dear Hiring Manager,\n\nI am writing to apply for the ${jobTitle} role at ${companyName}. ` +
        'I have extensive hands-on experience with PostgreSQL from several production projects.' +
        `\n\nSincerely, contributing to ${companyName}.`;

      const attempt1Letter = pythonDockerLetter('Acme Corp', 'Backend Engineer'); // rejects: python, docker
      const attempt2Letter = postgresqlLetter('Acme Corp', 'Backend Engineer'); // avoids python/docker; rejects: postgresql (new)
      const attempt3Letter = cleanLetter('Acme Corp', 'Backend Engineer'); // clean — succeeds

      mockOpenAICreate
        .mockResolvedValueOnce(openAiResponse(attempt1Letter))
        .mockResolvedValueOnce(openAiResponse(attempt2Letter))
        .mockResolvedValueOnce(openAiResponse(attempt3Letter));

      const result = await noAnthropicService.generateCoverLetter(
        NO_TECH_CV_TEXT,
        JOB_DESCRIPTION,
        'Backend Engineer',
        'Acme Corp',
        'professional',
        PRODUCTION_SKILL_EVIDENCE,
      );

      expect(result.content).toBe(attempt3Letter);
      expect(mockOpenAICreate).toHaveBeenCalledTimes(3);

      const attempt1Messages = messagesFromCall(mockOpenAICreate.mock.calls[0]);
      const attempt2Messages = messagesFromCall(mockOpenAICreate.mock.calls[1]);
      const attempt3Messages = messagesFromCall(mockOpenAICreate.mock.calls[2]);

      // Attempt 1: no repair note yet.
      expect(attempt1Messages).toHaveLength(2);

      // Attempt 2: repair note names only attempt 1's rejected terms.
      expect(attempt2Messages).toHaveLength(3);
      const attempt2Repair = attempt2Messages[1]!.content;
      expect(attempt2Repair).toContain('python');
      expect(attempt2Repair).toContain('docker');
      expect(attempt2Repair).not.toContain('postgresql');

      // Attempt 3: repair note names ALL THREE terms — python and docker
      // (attempt 1) ACCUMULATED with postgresql (attempt 2's new
      // rejection). This is the exact required behavior: an earlier
      // rejection's terms must not disappear just because a later attempt
      // introduced a different violation.
      expect(attempt3Messages).toHaveLength(3);
      const attempt3Repair = attempt3Messages[1]!.content;
      expect(attempt3Repair).toContain('python');
      expect(attempt3Repair).toContain('docker');
      expect(attempt3Repair).toContain('postgresql');

      // Still privacy-safe: no CV/job description/generated-letter content.
      expect(attempt3Repair).not.toContain(NO_TECH_CV_TEXT);
      expect(attempt3Repair).not.toContain(JOB_DESCRIPTION);
      expect(attempt3Repair).not.toContain(attempt1Letter);
      expect(attempt3Repair).not.toContain(attempt2Letter);
    });

    it('does not lose accumulated repair terms when an intervening attempt fails for a non-grounding reason (e.g. a timeout)', async () => {
      const noAnthropicService = buildService(undefined);

      const pythonDockerLetter = (companyName: string, jobTitle: string) =>
        `Dear Hiring Manager,\n\nI am writing to apply for the ${jobTitle} role at ${companyName}. ` +
        'I have extensive hands-on experience with Python and Docker from several academic and ' +
        `personal projects.\n\nSincerely, contributing to ${companyName}.`;

      const attempt1Letter = pythonDockerLetter('Acme Corp', 'Backend Engineer');
      const attempt3Letter = cleanLetter('Acme Corp', 'Backend Engineer');

      mockOpenAICreate
        .mockResolvedValueOnce(openAiResponse(attempt1Letter))
        .mockRejectedValueOnce(new Error('Request timed out')) // non-grounding failure
        .mockResolvedValueOnce(openAiResponse(attempt3Letter));

      const result = await noAnthropicService.generateCoverLetter(
        NO_TECH_CV_TEXT,
        JOB_DESCRIPTION,
        'Backend Engineer',
        'Acme Corp',
        'professional',
        PRODUCTION_SKILL_EVIDENCE,
      );

      expect(result.content).toBe(attempt3Letter);
      expect(mockOpenAICreate).toHaveBeenCalledTimes(3);

      // Attempt 3's repair note still carries attempt 1's terms — the
      // intervening timeout did not clear the accumulated set.
      const attempt3Messages = messagesFromCall(mockOpenAICreate.mock.calls[2]);
      expect(attempt3Messages).toHaveLength(3);
      expect(attempt3Messages[1]!.content).toContain('python');
      expect(attempt3Messages[1]!.content).toContain('docker');
    });

    it('never exposes the repair instruction to the caller — only the final clean content is returned', async () => {
      const badLetter = overclaimingLetter('Acme Corp', 'Backend Engineer');
      const goodLetter = cleanLetter('Acme Corp', 'Backend Engineer');
      mockOpenAICreate
        .mockResolvedValueOnce(openAiResponse(badLetter))
        .mockResolvedValueOnce(openAiResponse(goodLetter));

      const result = await service.generateCoverLetter(
        NO_TECH_CV_TEXT,
        JOB_DESCRIPTION,
        'Backend Engineer',
        'Acme Corp',
        'professional',
        PRODUCTION_SKILL_EVIDENCE,
      );

      expect(result.content).toBe(goodLetter);
      expect(result).not.toHaveProperty('repairInstruction');
      expect(result.content).not.toContain('previous draft was rejected');
    });

    // ─── (9): the final grounding guard still runs on every attempt ────────

    it('still validates a repaired attempt — a second rejection is caught, not blindly trusted', async () => {
      const badLetter1 = overclaimingLetter('Acme Corp', 'Backend Engineer');
      const badLetter2 = 'Too short to pass validation.'; // still rejected, different reason
      const goodLetter = cleanLetter('Acme Corp', 'Backend Engineer');
      mockOpenAICreate
        .mockResolvedValueOnce(openAiResponse(badLetter1))
        .mockResolvedValueOnce(openAiResponse(badLetter2))
        .mockResolvedValueOnce(openAiResponse(goodLetter));

      const result = await service.generateCoverLetter(
        NO_TECH_CV_TEXT,
        JOB_DESCRIPTION,
        'Backend Engineer',
        'Acme Corp',
        'professional',
        PRODUCTION_SKILL_EVIDENCE,
      );

      expect(result.content).toBe(goodLetter);
      expect(mockOpenAICreate).toHaveBeenCalledTimes(3);

      // Attempt 3 still carries a repair note (repair feedback persists
      // across the intervening non-grounding "too short" rejection).
      const thirdMessages = messagesFromCall(mockOpenAICreate.mock.calls[2]);
      expect(thirdMessages).toHaveLength(3);
      expect(thirdMessages[1]!.content).toContain('python');
    });

    // ─── (8): continuous fabrication still exhausts all attempts ───────────

    it('still fails after all attempts when the model keeps fabricating the same unsupported experience', async () => {
      const badLetter = overclaimingLetter('Acme Corp', 'Backend Engineer');
      mockOpenAICreate.mockResolvedValue(openAiResponse(badLetter));
      mockAnthropicCreate.mockResolvedValue(anthropicResponse(badLetter));

      await expect(
        service.generateCoverLetter(
          NO_TECH_CV_TEXT,
          JOB_DESCRIPTION,
          'Backend Engineer',
          'Acme Corp',
          'professional',
          PRODUCTION_SKILL_EVIDENCE,
        ),
      ).rejects.toThrow('Cover letter generation failed after retries');

      expect(mockOpenAICreate).toHaveBeenCalledTimes(3);
      expect(mockAnthropicCreate).toHaveBeenCalledTimes(3);

      // Repair feedback carries over into the Anthropic fallback too — same
      // underlying CV/evidence, same rejection reason still applies.
      const anthropicCall = (mockAnthropicCreate.mock.calls[0] as [{ system: string }])[0];
      expect(anthropicCall.system).toContain('python');
      expect(anthropicCall.system).not.toContain(badLetter);
    });

    // ─── (1)/(2)/(3): genuinely unsupported vs. genuinely safe phrasing ────

    it('(1) still rejects a genuinely unsupported professional-experience claim even with repair feedback available', async () => {
      const badLetter =
        'Dear Hiring Manager,\n\nI am writing to apply for the Backend Engineer role at Acme Corp. ' +
        'I have hands-on Kubernetes experience from leading several production deployments.' +
        '\n\nSincerely, contributing to Acme Corp.';
      mockOpenAICreate.mockResolvedValue(openAiResponse(badLetter));
      mockAnthropicCreate.mockResolvedValue(anthropicResponse(badLetter));

      await expect(
        service.generateCoverLetter(
          NO_TECH_CV_TEXT,
          JOB_DESCRIPTION,
          'Backend Engineer',
          'Acme Corp',
          'professional',
          PRODUCTION_SKILL_EVIDENCE, // Kubernetes is not listed anywhere
        ),
      ).rejects.toThrow('Cover letter generation failed after retries');
    });

    it('(2) does not treat a CV-listed skill as unsupported (first attempt passes, no repair needed)', async () => {
      const letter =
        'Dear Hiring Manager,\n\nI am writing to apply for the Backend Engineer role at Acme Corp. ' +
        'I have knowledge of Python and Git from my coursework and personal projects. I am excited ' +
        'about the opportunity to bring this foundation to your team and contribute to meaningful ' +
        'work from day one.\n\nThank you for your consideration.\n\nSincerely, contributing to Acme Corp.';
      mockOpenAICreate.mockResolvedValue(openAiResponse(letter));

      const result = await service.generateCoverLetter(
        NO_TECH_CV_TEXT,
        JOB_DESCRIPTION,
        'Backend Engineer',
        'Acme Corp',
        'professional',
        PRODUCTION_SKILL_EVIDENCE, // Python and Git are genuinely listed skills
      );

      expect(result.content).toBe(letter);
      expect(mockOpenAICreate).toHaveBeenCalledTimes(1);
    });

    it('(3) describing an unsupported job requirement as a learning interest passes without rejection', async () => {
      const letter =
        'Dear Hiring Manager,\n\nI am writing to apply for the Backend Engineer role at Acme Corp. ' +
        "The role's focus on CI/CD and cloud platforms is particularly appealing to me, and I am " +
        'eager to grow my experience in these areas.\n\nSincerely, contributing to Acme Corp.';
      mockOpenAICreate.mockResolvedValue(openAiResponse(letter));

      const result = await service.generateCoverLetter(
        NO_TECH_CV_TEXT,
        JOB_DESCRIPTION,
        'Backend Engineer',
        'Acme Corp',
        'professional',
        PRODUCTION_SKILL_EVIDENCE,
      );

      expect(result.content).toBe(letter);
      expect(mockOpenAICreate).toHaveBeenCalledTimes(1);
    });

    // ─── (4): soft-skill wording does not create obvious false positives ───

    it('(4) a modest, CV-listed soft-skill mention does not trigger a technology-possession-style rejection', async () => {
      const evidenceWithSoftSkill: CvEvidence = {
        ...PRODUCTION_SKILL_EVIDENCE,
        skillsOnlyTerms: [...PRODUCTION_SKILL_EVIDENCE.skillsOnlyTerms, 'Problem-solving'],
      };
      const letter =
        'Dear Hiring Manager,\n\nI am writing to apply for the Backend Engineer role at Acme Corp. ' +
        'I have strong problem-solving experience from my coursework and side projects, and I have ' +
        'knowledge of Python.\n\nSincerely, contributing to Acme Corp.';
      mockOpenAICreate.mockResolvedValue(openAiResponse(letter));

      const result = await service.generateCoverLetter(
        NO_TECH_CV_TEXT,
        JOB_DESCRIPTION,
        'Backend Engineer',
        'Acme Corp',
        'professional',
        evidenceWithSoftSkill,
      );

      expect(result.content).toBe(letter);
      expect(mockOpenAICreate).toHaveBeenCalledTimes(1);
    });
  });
});
