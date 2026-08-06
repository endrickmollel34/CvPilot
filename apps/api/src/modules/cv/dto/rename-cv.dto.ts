import { IsString, IsNotEmpty, MaxLength } from 'class-validator';

export class RenameCvDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  title!: string;
}
