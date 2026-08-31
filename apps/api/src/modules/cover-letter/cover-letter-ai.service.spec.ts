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
// company/title, mentions only genuinely-supported experience).
function cleanLetter(companyName: string, jobTitle: string): string {
  return (
    `Dear Hiring Manager,\n\nI am writing to apply for the ${jobTitle} position at ${companyName}. ` +
    'My academic background in Computer Science, combined with hands-on project work building an ' +
    'inventory tracking tool, has given me a solid foundation in problem-solving and structured ' +
    'thinking. In my retail role I regularly balanced competing priorities while staying attentive ' +
    'to detail, a habit I bring to every project I take on.\n\nI would welcome the chance to bring ' +
    `this mindset to ${companyName} and grow alongside the team. Thank you for your consideration.\n\n` +
    'Sincerely'
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

  it('accepts a possession claim about a skill supplied via the structured skills list, not just parsedContent', async () => {
    // NO_TECH_CV_TEXT never mentions Docker — this only passes validation
    // because 'Docker' is supplied via the structured candidateSkills
    // parameter, proving that list is actually wired into the evidence the
    // guard checks against (not just into the prompt).
    const letter =
      'Dear Hiring Manager,\n\nI am writing to apply for the Backend Engineer role at Acme Corp. ' +
      'I am well-versed in Docker, and my academic background gives me a strong foundation to build on.' +
      '\n\nI look forward to bringing this experience to Acme Corp. Sincerely';
    mockOpenAICreate.mockResolvedValue(openAiResponse(letter));

    const result = await service.generateCoverLetter(
      NO_TECH_CV_TEXT,
      'We need a backend engineer skilled in Docker.',
      'Backend Engineer',
      'Acme Corp',
      'professional',
      ['Docker'],
    );

    expect(result.content).toBe(letter);
    expect(mockAnthropicCreate).not.toHaveBeenCalled();
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
