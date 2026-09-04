import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';

import { resolveOptionalApiKey } from '../../common/utils/optional-api-key.util';

// CV_CONTENT is the only source of truth about what the candidate has
// actually done — JOB_DESCRIPTION describes what the employer wants, and a
// term appearing there is never, by itself, evidence the candidate has it.
// This mirrors the grounding conventions already used for cover letters
// (cover-letter-ai.service.ts) and tailoring (tailoring-ai.service.ts).
// AnalysisService.process() also re-checks every suggestion deterministically
// against CV_CONTENT after this call returns (see
// recommendation-grounding.util.ts) — this prompt is the first line of
// defense, not the only one.
const ANALYSIS_SYSTEM_PROMPT =
  'You are an expert CV/resume analyst. CV_CONTENT is the only source of truth about what the candidate has ' +
  'actually done. JOB_DESCRIPTION describes what the employer wants — mentioning a term there is NEVER, by ' +
  'itself, evidence the candidate has it. ' +
  'Never write a suggestion that tells the candidate to add, claim, or imply possession of a skill, ' +
  'responsibility, achievement, qualification, employer, industry, metric, certification, or event type unless ' +
  'it is genuinely supported by CV_CONTENT. ' +
  'When a job requirement has no support in CV_CONTENT, phrase the suggestion conditionally — e.g. "If you have ' +
  'experience with X, add a concrete example of it" — never as a plain instruction to add or claim X. ' +
  'When CV_CONTENT already supports something, you may suggest strengthening or clarifying how it is expressed, ' +
  'but never invent details (dates, metrics, employers, tools) beyond what is written. ' +
  'Only raise formatting/structure issues that plain extracted text can actually establish — missing sections, ' +
  'section order, wording, length. Never claim visual/layout details such as tables, columns, graphics, images, ' +
  'fonts, or colors: you only receive plain extracted text, never the original file layout. ' +
  'Each suggestion must be specific and tied to an identifiable CV section, bullet, skill, or job requirement — ' +
  'avoid generic boilerplate advice, and never produce more than one suggestion about the same missing keyword ' +
  'or gap. ' +
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
    { "keyword": "<key term from job description>", "found": <true only if the term, or a clear equivalent, genuinely appears in CV_CONTENT> }
  ]
}
Rules:
- suggestions must have 3-20 items, each specific and non-repetitive — never produce multiple suggestions about the same missing keyword or gap.
- MISSING_KEYWORD suggestions must be phrased conditionally (e.g. "If you have experience with X, add a concrete example showing it") — never as an instruction to simply add or claim X, since that would encourage misrepresenting the candidate's background.
- WEAK_LANGUAGE suggestions must only target language already present in CV_CONTENT — never introduce a new, unsupported claim under this category.
- STRUCTURE and ATS_WARNING suggestions must only describe issues inferable from plain text (missing sections, ordering, wording, length) — never claim visual/layout details such as tables, columns, graphics, or fonts.
- List all key terms from the job description in ats_keywords.`;
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
  // Genuinely optional — OpenAI is the required primary provider; Anthropic
  // is only ever a fallback and must never block boot. undefined means "not
  // configured" (unset or an obvious placeholder value), not "broken."
  private readonly anthropic?: Anthropic;

  constructor(private readonly config: ConfigService) {
    this.openai = new OpenAI({ apiKey: config.getOrThrow<string>('OPENAI_API_KEY') });

    const anthropicKey = resolveOptionalApiKey(config, 'ANTHROPIC_API_KEY');
    this.anthropic = anthropicKey ? new Anthropic({ apiKey: anthropicKey }) : undefined;
  }

  async runAnalysis(cvText: string, jobDescription: string): Promise<AiCallResult> {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        return await this.callOpenAI(cvText, jobDescription);
      } catch (err) {
        this.logger.warn(`OpenAI analysis attempt ${attempt}/${MAX_ATTEMPTS} failed`, err);
      }
    }

    if (!this.anthropic) {
      this.logger.warn('OpenAI exhausted — Anthropic fallback is not configured, failing');
      throw new Error('Analysis failed: all AI providers exhausted after retries');
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
    // Unreachable in practice — runAnalysis() never enters the Anthropic
    // retry loop when this.anthropic is undefined — kept as a type-safe
    // defensive guard rather than a non-null assertion.
    if (!this.anthropic) {
      throw new Error('Anthropic client is not configured');
    }

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
