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
}
