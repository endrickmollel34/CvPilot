import { resolvePeriodLabel } from './billingLabels';

describe('resolvePeriodLabel', () => {
  it('shows "Renews" when the subscription is not scheduled to cancel', () => {
    expect(resolvePeriodLabel(false)).toBe('Renews');
  });

  it('shows "Access until" — not "Renews" — when cancelAtPeriodEnd is true, so a cancelled-but-still-active subscription never implies another charge is coming', () => {
    expect(resolvePeriodLabel(true)).toBe('Access until');
  });
});
