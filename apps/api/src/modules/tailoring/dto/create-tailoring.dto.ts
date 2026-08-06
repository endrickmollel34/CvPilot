import { IsString, IsUUID, IsOptional, MinLength, MaxLength } from 'class-validator';

export class CreateTailoringDto {
  @IsUUID()
  cvId!: string;

  @IsString()
  @IsOptional()
  @MaxLength(255)
  jobTitle?: string;

  @IsString()
  @IsOptional()
  @MaxLength(255)
  companyName?: string;

  @IsString()
  @MinLength(50)
  @MaxLength(10000)
  jobDescription!: string;
}
