import { IsIn } from 'class-validator';

export class CreateCheckoutDto {
  @IsIn(['pro', 'student'])
  plan!: 'pro' | 'student';
}
