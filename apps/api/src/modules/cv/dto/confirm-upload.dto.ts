import { IsString, IsNotEmpty, IsIn, IsInt, IsPositive, Max } from 'class-validator';

import { ALLOWED_MIME_TYPES, MAX_FILE_SIZE_BYTES } from './generate-upload-url.dto';

export class ConfirmUploadDto {
  @IsString()
  @IsNotEmpty()
  r2ObjectKey!: string;

  @IsString()
  @IsNotEmpty()
  fileName!: string;

  // NOT the source of truth — kept only for API compatibility with the
  // existing frontend call shape and as a cheap defense-in-depth rejection
  // of obviously-lying requests before a HEAD round-trip is even made. The
  // actual enforced size is CvService.confirmUpload()'s HeadObjectCommand
  // result against the real R2 object; this field is never persisted to
  // the DB and never trusted for the ≤5 MB decision.
  @IsInt()
  @IsPositive()
  @Max(MAX_FILE_SIZE_BYTES)
  fileSizeBytes!: number;

  @IsIn(ALLOWED_MIME_TYPES)
  mimeType!: string;
}
