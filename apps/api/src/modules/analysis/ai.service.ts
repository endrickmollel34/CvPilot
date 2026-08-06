import { Injectable, Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';

const ANALYSIS_SYSTEM_PROMPT =
  'You are an expert CV/resume analyst. Analyse the candidate CV against the job description and return structured feedback. ' +
  'Respond with ONLY valid JSON — no markdown fences, no explanation, no preamble.';

function buildUserPrompt(cvText: string, jobDescription: string): string {
  return `<CV_CONTENT>
${cvText}
</CV_CONTENT>

<JOB_DESCRIPTION>
${jobDescription}
</JOB_DESCRIPTION>

Return a JSON object with this exact structure:
{
  "match_score": <integer 0-100, how well the CV matches the role>,
  "suggestions": [
    { "category": "MISSING_KEYWORD"|"WEAK_LANGUAGE"|"STRUCTURE"|"ATS_WARNING", "priority": "HIGH"|"MEDIUM"|"LOW", "text": "<string 10-500 chars>" }
  ],
  "ats_keywords": [
    { "keyword": "<key term from job description>", "found": <true if present in CV, else false> }
  ]
}
Rules: suggestions must have 3-20 items. List all key terms from the job description in ats_keywords.`;
}

export const AnalysisResponseSchema = z.object({
  match_score: z.number().int().min(0).max(100),
  suggestions: z
    .array(
      z.object({
        category: z.enum(['MISSING_KEYWORD', 'WEAK_LANGUAGE', 'STRUCTURE', 'ATS_WARNING']),
        priority: z.enum(['HIGH', 'MEDIUM', 'LOW']),
        text: z.string().min(10).max(500),
      }),
    )
    .min(3)
    .max(20),
  ats_keywords: z.array(z.object({ keyword: z.string(), found: z.boolean() })),
});

export type AnalysisAiResult = z.infer<typeof AnalysisResponseSchema>;

interface AiCallResult {
  result: AnalysisAiResult;
  modelUsed: string;
  tokensUsed: number;
}

const MAX_ATTEMPTS = 3;

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private readonly openai: OpenAI;
  private readonly anthropic: Anthropic;

  constructor(private readonly config: ConfigService) {
    this.openai = new OpenAI({ apiKey: config.getOrThrow<string>('OPENAI_API_KEY') });
    this.anthropic = new Anthropic({ apiKey: config.getOrThrow<string>('ANTHROPIC_API_KEY') });
  }

  async runAnalysis(cvText: string, jobDescription: string): Promise<AiCallResult> {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        return await this.callOpenAI(cvText, jobDescription);
      } catch (err) {
        this.logger.warn(`OpenAI analysis attempt ${attempt}/${MAX_ATTEMPTS} failed`, err);
      }
    }

    this.logger.warn('OpenAI exhausted — activating Anthropic fallback');

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        return await this.callAnthropic(cvText, jobDescription);
      } catch (err) {
        this.logger.warn(`Anthropic analysis attempt ${attempt}/${MAX_ATTEMPTS} failed`, err);
      }
    }

    throw new Error('Analysis failed: all AI providers exhausted after retries');
  }

  private async callOpenAI(cvText: string, jobDescription: string): Promise<AiCallResult> {
    const response = await this.openai.chat.completions.create({
      model: 'gpt-4o',
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: ANALYSIS_SYSTEM_PROMPT },
        { role: 'user', content: buildUserPrompt(cvText, jobDescription) },
      ],
    });

    const raw: unknown = JSON.parse(response.choices[0]?.message?.content ?? '{}');
    const result = AnalysisResponseSchema.parse(raw);

    return {
      result,
      modelUsed: 'gpt-4o',
      tokensUsed: response.usage?.total_tokens ?? 0,
    };
  }

  private async callAnthropic(cvText: string, jobDescription: string): Promise<AiCallResult> {
    const response = await this.anthropic.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 2048,
      temperature: 0.2,
      system: ANALYSIS_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildUserPrompt(cvText, jobDescription) }],
    });

    const block = response.content[0];
    if (!block || block.type !== 'text') {
      throw new Error('Unexpected Anthropic response format');
    }

    const raw: unknown = JSON.parse(block.text);
    const result = AnalysisResponseSchema.parse(raw);

    return {
      result,
      modelUsed: 'claude-3-5-sonnet-20241022',
      tokensUsed: response.usage.input_tokens + response.usage.output_tokens,
    };
  }
}
