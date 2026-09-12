import { IsIn } from 'class-validator';
import type { BillingProduct } from '@cvpilot/shared';

// Student is deliberately not a valid value here — it must never be
// selectable as a new checkout product again. Existing Student subscribers
// are unaffected (see StripePaymentProvider's legacy price-id handling and
// BillingService.resolveEffectivePlan's normalization); this DTO only
// gates what a *new* checkout request may ask to purchase.
export class CreateCheckoutDto {
  @IsIn(['pro_monthly', 'pro_annual'])
  product!: BillingProduct;
}
