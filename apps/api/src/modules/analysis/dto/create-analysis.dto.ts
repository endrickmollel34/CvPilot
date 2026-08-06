import { IsUUID, IsString, IsNotEmpty, IsOptional, MaxLength } from 'class-validator';

export class CreateAnalysisDto {
  @IsUUID()
  cvId!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  jobTitle!: string;

  @IsString()
  @IsOptional()
  @MaxLength(255)
  companyName?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(10000)
  jobDescription!: string;
}
