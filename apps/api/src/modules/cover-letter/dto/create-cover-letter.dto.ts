import { Transform } from 'class-transformer';
import { IsString, IsUUID, IsOptional, MaxLength, IsIn } from 'class-validator';

// Trims before validation runs (ValidationPipe's transform:true applies
// class-transformer first). Without this, stray leading/trailing whitespace
// from a copy-pasted job title or company name (e.g. "Backend Software
// Engineer " with a trailing space) survives into CoverLetterAiService's
// exact-substring validateOutput() check — the generated letter naturally
// won't reproduce that exact trailing whitespace before its own punctuation,
// so the check fails every attempt and exhausts all retries regardless of
// whether the model actually mentioned the role. See submit-contact.dto.ts
// for the same pattern used elsewhere in the codebase.
const trim = () =>
  Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value));

export class CreateCoverLetterDto {
  @IsUUID()
  cvId!: string;

  @IsOptional()
  @IsUUID()
  analysisId?: string;

  @trim()
  @IsString()
  @MaxLength(255)
  jobTitle!: string;

  @trim()
  @IsString()
  @MaxLength(255)
  companyName!: string;

  @IsString()
  @MaxLength(10000)
  jobDescription!: string;

  @IsOptional()
  @IsIn(['professional', 'conversational', 'enthusiastic', 'formal'])
  tone?: 'professional' | 'conversational' | 'enthusiastic' | 'formal';

  // V2 — optional recipient/company detail for the letterhead. None of
  // these ever reach the AI prompt (see cover-letter-ai.service.ts) — they
  // are rendering-only, used by the live preview and the PDF.
  @IsOptional()
  @trim()
  @IsString()
  @MaxLength(255)
  recipientName?: string;

  @IsOptional()
  @trim()
  @IsString()
  @MaxLength(255)
  recipientTitle?: string;

  @IsOptional()
  @trim()
  @IsString()
  @MaxLength(1000)
  companyAddress?: string;

  // V2.1 — the candidate's own postal address for the sender block.
  // Optional, never required to generate a letter, never inferred from
  // the CV — see cover-letter.entity.ts's senderAddress doc comment.
  @IsOptional()
  @trim()
  @IsString()
  @MaxLength(1000)
  senderAddress?: string;
}
