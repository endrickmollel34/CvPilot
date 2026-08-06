import { IsString, IsUUID, IsOptional, MaxLength, IsIn } from 'class-validator';

export class CreateCoverLetterDto {
  @IsUUID()
  cvId!: string;

  @IsOptional()
  @IsUUID()
  analysisId?: string;

  @IsString()
  @MaxLength(255)
  jobTitle!: string;

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
