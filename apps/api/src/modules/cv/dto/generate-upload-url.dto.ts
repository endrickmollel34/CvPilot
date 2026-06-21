import { IsString, IsNotEmpty, IsIn, IsInt, Min, Max } from 'class-validator';

export const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
] as const;

export const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB

export class GenerateUploadUrlDto {
  @IsString()
  @IsNotEmpty()
  fileName!: string;

  @IsIn(ALLOWED_MIME_TYPES)
  mimeType!: string;

  @IsInt()
  @Min(1)
  @Max(MAX_FILE_SIZE_BYTES)
  fileSizeBytes!: number;
}
