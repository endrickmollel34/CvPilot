import { IsIn, IsInt, Min, Max } from 'class-validator';

export const ALLOWED_PHOTO_MIME_TYPES = ['image/png', 'image/jpeg'] as const;

export const MAX_PHOTO_SIZE_BYTES = 3 * 1024 * 1024; // 3 MB

export class PhotoUploadUrlDto {
  @IsIn(ALLOWED_PHOTO_MIME_TYPES)
  mimeType!: (typeof ALLOWED_PHOTO_MIME_TYPES)[number];

  @IsInt()
  @Min(1)
  @Max(MAX_PHOTO_SIZE_BYTES)
  fileSizeBytes!: number;
}
