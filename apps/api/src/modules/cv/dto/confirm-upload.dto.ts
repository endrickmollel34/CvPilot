import { IsString, IsNotEmpty, IsIn, IsInt, IsPositive } from 'class-validator';

import { ALLOWED_MIME_TYPES } from './generate-upload-url.dto';

export class ConfirmUploadDto {
  @IsString()
  @IsNotEmpty()
  r2ObjectKey!: string;

  @IsString()
  @IsNotEmpty()
  fileName!: string;

  @IsInt()
  @IsPositive()
  fileSizeBytes!: number;

  @IsIn(ALLOWED_MIME_TYPES)
  mimeType!: string;
}
