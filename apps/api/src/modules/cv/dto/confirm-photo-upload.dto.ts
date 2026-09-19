import { IsString, IsNotEmpty, IsIn, IsInt, IsPositive, Max } from 'class-validator';

import { ALLOWED_PHOTO_MIME_TYPES, MAX_PHOTO_SIZE_BYTES } from './photo-upload-url.dto';

export class ConfirmPhotoUploadDto {
  @IsString()
  @IsNotEmpty()
  r2ObjectKey!: string;

  // NOT the source of truth — see ConfirmUploadDto's identical field for
  // why: the actual enforced size is CvPhotoService.confirmUpload()'s
  // HeadObjectCommand result against the real R2 object, followed by the
  // full downloaded byte length actually used for validation/rendering.
  @IsInt()
  @IsPositive()
  @Max(MAX_PHOTO_SIZE_BYTES)
  fileSizeBytes!: number;

  @IsIn(ALLOWED_PHOTO_MIME_TYPES)
  mimeType!: (typeof ALLOWED_PHOTO_MIME_TYPES)[number];
}
