import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';

import type { CvContent } from '@cvpilot/shared';
import { TailoringAiService, TailoringResponseSchema } from './tailoring-ai.service';

// openai and @anthropic-ai/sdk are real HTTP clients constructed directly in
// TailoringAiService's constructor — mocked here so tests never make network
// calls. Both packages export their client as a plain callable (no
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

const mockConfig = {
  getOrThrow: jest.fn((key: string) => {
    const vals: Record<string, string> = {
      OPENAI_API_KEY: 'test-key',
      ANTHROPIC_API_KEY: 'test-key',
    };
    return vals[key] ?? '';
  }),
};

const CONTENT: CvContent = {
  version: 1,
  personalDetails: { fullName: 'Jane Doe', email: 'jane@example.com' },
  summary: 'Experienced backend engineer.',
  workExperience: [],
  education: [],
  skills: [],
  languages: [],
  certifications: [],
  sectionOrder: ['summary', 'workExperience', 'education', 'skills', 'languages', 'certifications'],
};

function openAiResponse(body: unknown, tokens = 100) {
  return {
    choices: [{ message: { content: JSON.stringify(body) } }],
    usage: { total_tokens: tokens },
  };
}

// ─── TailoringResponseSchema — Zod validation ────────────────────────────────

describe('TailoringResponseSchema', () => {
  it('accepts an empty suggestions array as a valid, successful result', () => {
    expect(() => TailoringResponseSchema.parse({ suggestions: [] })).not.toThrow();
    expect(TailoringResponseSchema.parse({ suggestions: [] }).suggestions).toEqual([]);
  });

  it('still enforces the 10-item maximum', () => {
    const tooMany = Array.from({ length: 11 }, (_, i) => ({
      id: `s${i}`,
      section: 'summary' as const,
      originalContent: '',
      suggestedContent: 'x',
      reason: 'A reasonable reason text that is long enough.',
      priority: 'LOW' as const,
    }));

    expect(() => TailoringResponseSchema.parse({ suggestions: tooMany })).toThrow();
  });

  it('still rejects a suggestion missing required fields', () => {
    expect(() =>
      TailoringResponseSchema.parse({
        suggestions: [{ id: 's1', section: 'summary' }],
      }),
    ).toThrow();
  });
});

// ─── TailoringAiService.runTailoring() ────────────────────────────────────────

describe('TailoringAiService', () => {
  let service: TailoringAiService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [TailoringAiService, { provide: ConfigService, useValue: mockConfig }],
    }).compile();

    service = module.get<TailoringAiService>(TailoringAiService);
  });

  it('treats an empty suggestions array as success — no retry, no Anthropic fallback', async () => {
    mockOpenAICreate.mockResolvedValue(openAiResponse({ suggestions: [] }, 250));

    const result = await service.runTailoring(
      CONTENT,
      'A job description this CV already matches very well.',
    );

    expect(result.suggestions).toEqual([]);
    expect(result.modelUsed).toBe('gpt-4o');
    expect(result.tokensUsed).toBe(250);
    expect(mockOpenAICreate).toHaveBeenCalledTimes(1);
    expect(mockAnthropicCreate).not.toHaveBeenCalled();
  });

  it('still returns non-empty suggestions on the normal path', async () => {
    const suggestions = [
      {
        id: 's1',
        section: 'summary',
        originalContent: 'Experienced backend engineer.',
        suggestedContent: 'Results-driven backend engineer with 5 years experience.',
        reason: 'More specific and keyword-rich for this role.',
        priority: 'HIGH',
      },
    ];
    mockOpenAICreate.mockResolvedValue(openAiResponse({ suggestions }));

    const result = await service.runTailoring(CONTENT, 'Job description text.');

    expect(result.suggestions).toHaveLength(1);
    expect(result.suggestions[0]!.suggestedContent).toBe(
      'Results-driven backend engineer with 5 years experience.',
    );
    expect(mockAnthropicCreate).not.toHaveBeenCalled();
  });

  it('still retries and falls back to Anthropic on a genuine schema violation', async () => {
    // Missing required fields — a real parse failure, unlike an empty array.
    mockOpenAICreate.mockResolvedValue(
      openAiResponse({ suggestions: [{ id: 's1', section: 'summary' }] }),
    );
    mockAnthropicCreate.mockResolvedValue({
      content: [{ type: 'text', text: JSON.stringify({ suggestions: [] }) }],
      usage: { input_tokens: 50, output_tokens: 20 },
    });

    const result = await service.runTailoring(CONTENT, 'Job description text.');

    expect(mockOpenAICreate).toHaveBeenCalledTimes(3); // OpenAI retries exhausted
    expect(mockAnthropicCreate).toHaveBeenCalledTimes(1); // fallback activated
    expect(result.modelUsed).toBe('claude-3-5-sonnet-20241022');
    expect(result.suggestions).toEqual([]);
  });
});
