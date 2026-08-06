import { IsString, MinLength, MaxLength } from 'class-validator';

export class UpdateCoverLetterDto {
  @IsString()
  @MinLength(50, { message: 'Cover letter content too short (minimum 50 characters)' })
  @MaxLength(8000, { message: 'Cover letter content too long (maximum 8000 characters)' })
  content!: string;
}
