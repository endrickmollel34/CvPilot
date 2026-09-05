import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';

import { CoverLetterAiService } from './cover-letter-ai.service';

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
      ).rejects.toThrow('all AI providers exhausted');

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
    ).rejects.toThrow('all AI providers exhausted');
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
    ).rejects.toThrow('all AI providers exhausted');
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
      ).rejects.toThrow('all AI providers exhausted');

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
      ).rejects.toThrow('all AI providers exhausted');

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
});
