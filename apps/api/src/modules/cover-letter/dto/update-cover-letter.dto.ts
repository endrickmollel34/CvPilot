import { Transform } from 'class-transformer';
import { IsString, IsOptional, MinLength, MaxLength, IsIn } from 'class-validator';

// Same trim-before-validate pattern as create-cover-letter.dto.ts (see its
// own comment for why) — duplicated rather than imported across DTO files,
// matching this codebase's existing convention (see submit-contact.dto.ts).
const trim = () =>
  Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value));

// V2 — every field is now optional so this DTO can express a genuine
// partial update: the workspace autosaves structured fields (job title,
// company, recipient details, job description, tone) and the letter body
// independently/together on the same debounce, and callers should only
// ever send the fields that actually changed. `content`, when present,
// keeps its original length bounds — an empty PATCH body is valid (a
// no-op) and callers are not required to always include content.
export class UpdateCoverLetterDto {
  @IsOptional()
  @IsString()
  @MinLength(50, { message: 'Cover letter content too short (minimum 50 characters)' })
  @MaxLength(8000, { message: 'Cover letter content too long (maximum 8000 characters)' })
  content?: string;

  @IsOptional()
  @trim()
  @IsString()
  @MaxLength(255)
  jobTitle?: string;

  @IsOptional()
  @trim()
  @IsString()
  @MaxLength(255)
  companyName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10000)
  jobDescription?: string;

  @IsOptional()
  @IsIn(['professional', 'conversational', 'enthusiastic', 'formal'])
  tone?: 'professional' | 'conversational' | 'enthusiastic' | 'formal';

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

  // V2.1 — typed `| null` (unlike its siblings above) so the editor can
  // explicitly clear a previously-set sender address: @IsOptional() skips
  // all further validators for both `undefined` (field omitted — "leave
  // unchanged") and `null` (field explicitly cleared) — see
  // cover-letter.entity.ts's senderAddress doc comment for the full
  // undefined-vs-null distinction this relies on.
  @IsOptional()
  @trim()
  @IsString()
  @MaxLength(1000)
  senderAddress?: string | null;
}
