import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { CreateCheckoutDto } from './create-checkout.dto';

describe('CreateCheckoutDto', () => {
  it('accepts "pro"', async () => {
    const dto = plainToInstance(CreateCheckoutDto, { plan: 'pro' });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('accepts "student"', async () => {
    const dto = plainToInstance(CreateCheckoutDto, { plan: 'student' });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('rejects "free" (not a purchasable plan)', async () => {
    const dto = plainToInstance(CreateCheckoutDto, { plan: 'free' });
    expect(await validate(dto)).not.toHaveLength(0);
  });

  it('rejects an arbitrary/unknown plan value', async () => {
    const dto = plainToInstance(CreateCheckoutDto, { plan: 'enterprise' });
    expect(await validate(dto)).not.toHaveLength(0);
  });

  it('rejects a missing plan', async () => {
    const dto = plainToInstance(CreateCheckoutDto, {});
    expect(await validate(dto)).not.toHaveLength(0);
  });
});
