import { IsArray, ValidateNested, IsString, IsEnum, IsOptional } from 'class-validator';
import { Type } from 'class-transformer';

class TailoringDecisionDto {
  @IsString()
  suggestionId!: string;

  @IsEnum(['accepted', 'rejected'])
  decision!: 'accepted' | 'rejected';

  @IsString()
  @IsOptional()
  editedContent?: string;
}

export class ApplySuggestionsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TailoringDecisionDto)
  decisions!: TailoringDecisionDto[];
}
