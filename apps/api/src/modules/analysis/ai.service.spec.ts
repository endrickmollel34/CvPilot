import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';

import { AiService } from './ai.service';

// openai and @anthropic-ai/sdk are real HTTP clients constructed directly in
// AiService's constructor — mocked here so tests never make network calls.
// Both packages export their client as a plain callable (no __esModule
// marker), so a bare jest.fn() constructor mock matches their real shape
// under esModuleInterop.
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

function buildService(anthropicKeyValue: string | undefined): AiService {
  const config = {
    getOrThrow: mockConfig.getOrThrow,
    get: jest.fn((key: string) => (key === 'ANTHROPIC_API_KEY' ? anthropicKeyValue : undefined)),
  };
  return new AiService(config as unknown as ConfigService);
}

const VALID_SUGGESTIONS = [
  {
    category: 'MISSING_KEYWORD',
    priority: 'HIGH',
    text: 'Add "Kubernetes" — it appears in the job description.',
  },
  {
    category: 'WEAK_LANGUAGE',
    priority: 'MEDIUM',
    text: 'Replace "helped with" with a stronger action verb.',
  },
  {
    category: 'STRUCTURE',
    priority: 'LOW',
    text: 'Move the summary section above work experience.',
  },
];

function validAnalysisBody(matchScore = 75) {
  return {
    match_score: matchScore,
    suggestions: VALID_SUGGESTIONS,
    ats_keywords: [{ keyword: 'Kubernetes', found: false }],
  };
}

function openAiResponse(body: unknown, tokens = 100) {
  return {
    choices: [{ message: { content: JSON.stringify(body) } }],
    usage: { total_tokens: tokens },
  };
}

function anthropicResponse(body: unknown) {
  return {
    content: [{ type: 'text', text: JSON.stringify(body) }],
    usage: { input_tokens: 50, output_tokens: 20 },
  };
}

const CV_TEXT = 'Experienced backend engineer with 5 years of Node.js experience.';
const JOB_DESCRIPTION = 'Looking for a backend engineer with Kubernetes experience.';

describe('AiService', () => {
  let service: AiService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [AiService, { provide: ConfigService, useValue: mockConfig }],
    }).compile();

    service = module.get<AiService>(AiService);
  });

  it('returns the OpenAI result on the happy path — no Anthropic call', async () => {
    mockOpenAICreate.mockResolvedValue(openAiResponse(validAnalysisBody(80), 300));

    const result = await service.runAnalysis(CV_TEXT, JOB_DESCRIPTION);

    expect(result.result.match_score).toBe(80);
    expect(result.modelUsed).toBe('gpt-4o');
    expect(result.tokensUsed).toBe(300);
    expect(mockOpenAICreate).toHaveBeenCalledTimes(1);
    expect(mockAnthropicCreate).not.toHaveBeenCalled();
  });

  it('falls back to Anthropic after OpenAI is exhausted on a genuine schema violation', async () => {
    mockOpenAICreate.mockResolvedValue(openAiResponse({ match_score: 'not-a-number' }));
    mockAnthropicCreate.mockResolvedValue(anthropicResponse(validAnalysisBody(60)));

    const result = await service.runAnalysis(CV_TEXT, JOB_DESCRIPTION);

    expect(mockOpenAICreate).toHaveBeenCalledTimes(3);
    expect(mockAnthropicCreate).toHaveBeenCalledTimes(1);
    expect(result.modelUsed).toBe('claude-3-5-sonnet-20241022');
    expect(result.result.match_score).toBe(60);
  });

  it('fails with the generic exhaustion error when both providers fail', async () => {
    mockOpenAICreate.mockRejectedValue(new Error('OpenAI down'));
    mockAnthropicCreate.mockRejectedValue(new Error('Anthropic down'));

    await expect(service.runAnalysis(CV_TEXT, JOB_DESCRIPTION)).rejects.toThrow(
      'all AI providers exhausted',
    );

    expect(mockOpenAICreate).toHaveBeenCalledTimes(3);
    expect(mockAnthropicCreate).toHaveBeenCalledTimes(3);
  });

  // ─── Anthropic is a genuinely optional fallback ────────────────────────────

  describe('optional Anthropic fallback', () => {
    it('fails cleanly after OpenAI is exhausted when ANTHROPIC_API_KEY is unset — never calls Anthropic', async () => {
      const noAnthropicService = buildService(undefined);
      mockOpenAICreate.mockRejectedValue(new Error('OpenAI down'));

      await expect(noAnthropicService.runAnalysis(CV_TEXT, JOB_DESCRIPTION)).rejects.toThrow(
        'all AI providers exhausted',
      );

      expect(mockOpenAICreate).toHaveBeenCalledTimes(3);
      expect(mockAnthropicCreate).not.toHaveBeenCalled();
    });

    it('fails cleanly and never calls Anthropic when ANTHROPIC_API_KEY is an obvious placeholder value', async () => {
      const placeholderService = buildService('sk-ant-placeholder-dev-only');
      mockOpenAICreate.mockRejectedValue(new Error('OpenAI down'));

      await expect(placeholderService.runAnalysis(CV_TEXT, JOB_DESCRIPTION)).rejects.toThrow(
        'all AI providers exhausted',
      );

      expect(mockOpenAICreate).toHaveBeenCalledTimes(3);
      expect(mockAnthropicCreate).not.toHaveBeenCalled();
    });

    it('still falls back to Anthropic when a real key is configured (unaffected by the optionality change)', async () => {
      const configuredService = buildService('sk-ant-real-key');
      mockOpenAICreate.mockRejectedValue(new Error('OpenAI down'));
      mockAnthropicCreate.mockResolvedValue(anthropicResponse(validAnalysisBody(55)));

      const result = await configuredService.runAnalysis(CV_TEXT, JOB_DESCRIPTION);

      expect(result.modelUsed).toBe('claude-3-5-sonnet-20241022');
      expect(result.result.match_score).toBe(55);
      expect(mockAnthropicCreate).toHaveBeenCalledTimes(1);
    });

    it('OpenAI-only happy path is unaffected regardless of Anthropic configuration', async () => {
      const noAnthropicService = buildService(undefined);
      mockOpenAICreate.mockResolvedValue(openAiResponse(validAnalysisBody(90), 150));

      const result = await noAnthropicService.runAnalysis(CV_TEXT, JOB_DESCRIPTION);

      expect(result.result.match_score).toBe(90);
      expect(result.modelUsed).toBe('gpt-4o');
      expect(mockAnthropicCreate).not.toHaveBeenCalled();
    });
  });
});
