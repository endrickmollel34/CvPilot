import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { CreateCheckoutDto } from './create-checkout.dto';

describe('CreateCheckoutDto', () => {
  it('accepts "pro_monthly"', async () => {
    const dto = plainToInstance(CreateCheckoutDto, { product: 'pro_monthly' });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('accepts "pro_annual"', async () => {
    const dto = plainToInstance(CreateCheckoutDto, { product: 'pro_annual' });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('rejects "free" (not a purchasable product)', async () => {
    const dto = plainToInstance(CreateCheckoutDto, { product: 'free' });
    expect(await validate(dto)).not.toHaveLength(0);
  });

  // Student is no longer a selectable checkout product — existing Student
  // subscribers are unaffected (see StripePaymentProvider's legacy price-id
  // handling and BillingService.resolveEffectivePlan's normalization), but
  // a *new* checkout request can never ask to purchase it again.
  it('rejects "student" — Student can no longer be selected for a new checkout', async () => {
    const dto = plainToInstance(CreateCheckoutDto, { product: 'student' });
    expect(await validate(dto)).not.toHaveLength(0);
  });

  it('rejects an arbitrary/unknown product value', async () => {
    const dto = plainToInstance(CreateCheckoutDto, { product: 'enterprise' });
    expect(await validate(dto)).not.toHaveLength(0);
  });

  it('rejects a missing product', async () => {
    const dto = plainToInstance(CreateCheckoutDto, {});
    expect(await validate(dto)).not.toHaveLength(0);
  });
});
