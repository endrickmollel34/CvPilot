import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';

const SYSTEM_PROMPT_V1 =
  'You are an expert career coach writing a professional cover letter for a job applicant. ' +
  'Base the letter ONLY on information provided in the CV. ' +
  'Never invent, exaggerate, or imply qualifications, experience, education, or achievements ' +
  'that are not explicitly stated in the CV. ' +
  'Write in a natural, engaging voice — avoid robotic language, keyword stuffing, and clichés. ' +
  'Do not include placeholder text such as [Company Name], [Your Name], [Date], or any bracket notation. ' +
  'Return ONLY the cover letter body text — no subject line, no date, no signature block, no header. ' +
  'Aim for 3–4 well-structured paragraphs (200–600 words).';

function buildUserPrompt(
  cvText: string,
  jobDescription: string,
  jobTitle: string,
  companyName: string,
  tone: string,
): string {
  return `Write a ${tone} cover letter for the following role.

<JOB_TITLE>${jobTitle}</JOB_TITLE>
<COMPANY>${companyName}</COMPANY>

<JOB_DESCRIPTION>
${jobDescription}
</JOB_DESCRIPTION>

<CV_CONTENT>
${cvText}
</CV_CONTENT>

Write only the body paragraphs of the cover letter. Do not add placeholders. Mention the company name and job title naturally in the letter.`;
}

function validateOutput(text: string, companyName: string, jobTitle: string): void {
  if (text.length < 200) throw new Error('Generated cover letter is too short (min 200 chars)');
  if (text.length > 5000) throw new Error('Generated cover letter is too long (max 5000 chars)');
  if (text.includes('[') || text.includes(']')) {
    throw new Error('Generated cover letter contains placeholder brackets');
  }
  if (!text.toLowerCase().includes(companyName.toLowerCase())) {
    throw new Error(`Cover letter does not mention company name: ${companyName}`);
  }
  if (!text.toLowerCase().includes(jobTitle.toLowerCase())) {
    throw new Error(`Cover letter does not mention job title: ${jobTitle}`);
  }
}

export interface CoverLetterAiResult {
  content: string;
  modelUsed: string;
  tokensUsed: number;
}

const MAX_ATTEMPTS = 3;

@Injectable()
export class CoverLetterAiService {
  private readonly logger = new Logger(CoverLetterAiService.name);
  private readonly openai: OpenAI;
  private readonly anthropic: Anthropic;

  constructor(private readonly config: ConfigService) {
    this.openai = new OpenAI({ apiKey: config.getOrThrow<string>('OPENAI_API_KEY') });
    this.anthropic = new Anthropic({ apiKey: config.getOrThrow<string>('ANTHROPIC_API_KEY') });
  }

  async generateCoverLetter(
    cvText: string,
    jobDescription: string,
    jobTitle: string,
    companyName: string,
    tone = 'professional',
  ): Promise<CoverLetterAiResult> {
    const userPrompt = buildUserPrompt(cvText, jobDescription, jobTitle, companyName, tone);

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        return await this.callOpenAI(userPrompt, companyName, jobTitle);
      } catch (err) {
        this.logger.warn(`OpenAI cover letter attempt ${attempt}/${MAX_ATTEMPTS} failed`, err);
      }
    }

    this.logger.warn('OpenAI exhausted — activating Anthropic fallback');

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        return await this.callAnthropic(userPrompt, companyName, jobTitle);
      } catch (err) {
        this.logger.warn(`Anthropic cover letter attempt ${attempt}/${MAX_ATTEMPTS} failed`, err);
      }
    }

    throw new Error('Cover letter generation failed: all AI providers exhausted after retries');
  }

  private async callOpenAI(
    userPrompt: string,
    companyName: string,
    jobTitle: string,
  ): Promise<CoverLetterAiResult> {
    const response = await this.openai.chat.completions.create({
      model: 'gpt-4o',
      temperature: 0.7,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT_V1 },
        { role: 'user', content: userPrompt },
      ],
    });

    const content = response.choices[0]?.message?.content?.trim() ?? '';
    validateOutput(content, companyName, jobTitle);

    return {
      content,
      modelUsed: 'gpt-4o',
      tokensUsed: response.usage?.total_tokens ?? 0,
    };
  }

  private async callAnthropic(
    userPrompt: string,
    companyName: string,
    jobTitle: string,
  ): Promise<CoverLetterAiResult> {
    const response = await this.anthropic.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 2048,
      temperature: 0.7,
      system: SYSTEM_PROMPT_V1,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const block = response.content[0];
    if (!block || block.type !== 'text') {
      throw new Error('Unexpected Anthropic response format');
    }

    const content = block.text.trim();
    validateOutput(content, companyName, jobTitle);

    return {
      content,
      modelUsed: 'claude-3-5-sonnet-20241022',
      tokensUsed: response.usage.input_tokens + response.usage.output_tokens,
    };
  }
}
