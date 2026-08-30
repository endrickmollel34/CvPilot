import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ServiceUnavailableException, BadRequestException } from '@nestjs/common';

import { StripePaymentProvider } from './stripe.provider';

// stripe is a real HTTP client constructed directly in the provider's
// constructor — mocked here so tests never make network calls. It exports
// its client as a plain callable (no __esModule marker), so a bare jest.fn()
// constructor mock matches its real shape under esModuleInterop.
const mockCheckoutSessionsCreate = jest.fn();
const mockPortalSessionsCreate = jest.fn();
const mockWebhooksConstructEvent = jest.fn();
const mockSubscriptionsCancel = jest.fn();

jest.mock('stripe', () =>
  jest.fn().mockImplementation(() => ({
    checkout: { sessions: { create: (...args: unknown[]) => mockCheckoutSessionsCreate(...args) } },
    billingPortal: {
      sessions: { create: (...args: unknown[]) => mockPortalSessionsCreate(...args) },
    },
    webhooks: { constructEvent: (...args: unknown[]) => mockWebhooksConstructEvent(...args) },
    subscriptions: { cancel: (...args: unknown[]) => mockSubscriptionsCancel(...args) },
  })),
);

function makeConfig(overrides: Record<string, string> = {}) {
  const vals: Record<string, string> = {
    STRIPE_SECRET_KEY: 'sk_test_real123',
    STRIPE_WEBHOOK_SECRET: 'whsec_real123',
    STRIPE_PRICE_PRO_MONTHLY: 'price_pro_real123',
    STRIPE_PRICE_STUDENT_MONTHLY: 'price_student_real123',
    ...overrides,
  };
  return { getOrThrow: jest.fn((key: string) => vals[key]) };
}

async function buildProvider(config: { getOrThrow: jest.Mock }): Promise<StripePaymentProvider> {
  const module: TestingModule = await Test.createTestingModule({
    providers: [StripePaymentProvider, { provide: ConfigService, useValue: config }],
  }).compile();
  return module.get<StripePaymentProvider>(StripePaymentProvider);
}

const CHECKOUT_PARAMS = {
  userId: 'user-1',
  plan: 'pro' as const,
  currency: 'GBP' as const,
  successUrl: 'https://app.example.com/dashboard?checkout=success',
  cancelUrl: 'https://app.example.com/dashboard?checkout=cancelled',
};

describe('StripePaymentProvider', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ─── Configuration guard ────────────────────────────────────────────────────

  describe('configuration guard', () => {
    it.each([
      'STRIPE_SECRET_KEY',
      'STRIPE_WEBHOOK_SECRET',
      'STRIPE_PRICE_PRO_MONTHLY',
      'STRIPE_PRICE_STUDENT_MONTHLY',
    ])(
      'rejects createCheckoutSession with a controlled error when %s is a placeholder',
      async (key) => {
        const provider = await buildProvider(makeConfig({ [key]: 'placeholder' }));

        await expect(provider.createCheckoutSession(CHECKOUT_PARAMS)).rejects.toThrow(
          ServiceUnavailableException,
        );
        expect(mockCheckoutSessionsCreate).not.toHaveBeenCalled();
      },
    );

    it('rejects createCustomerPortalSession when Stripe is not configured', async () => {
      const provider = await buildProvider(makeConfig({ STRIPE_SECRET_KEY: 'placeholder' }));

      await expect(
        provider.createCustomerPortalSession({
          providerCustomerId: 'cus_1',
          returnUrl: 'https://app.example.com/dashboard',
        }),
      ).rejects.toThrow(ServiceUnavailableException);
      expect(mockPortalSessionsCreate).not.toHaveBeenCalled();
    });

    it('rejects verifyAndParseWebhook when Stripe is not configured', async () => {
      const provider = await buildProvider(makeConfig({ STRIPE_WEBHOOK_SECRET: 'placeholder' }));

      expect(() =>
        provider.verifyAndParseWebhook({ rawBody: Buffer.from('{}'), signature: 'sig' }),
      ).toThrow(ServiceUnavailableException);
      expect(mockWebhooksConstructEvent).not.toHaveBeenCalled();
    });

    it('rejects cancelSubscription when Stripe is not configured', async () => {
      const provider = await buildProvider(makeConfig({ STRIPE_PRICE_PRO_MONTHLY: 'placeholder' }));

      await expect(provider.cancelSubscription('sub_1')).rejects.toThrow(
        ServiceUnavailableException,
      );
      expect(mockSubscriptionsCancel).not.toHaveBeenCalled();
    });

    it('does not throw the raw Stripe SDK error — the message is a controlled, actionable one', async () => {
      const provider = await buildProvider(makeConfig({ STRIPE_SECRET_KEY: 'placeholder' }));

      await expect(provider.createCheckoutSession(CHECKOUT_PARAMS)).rejects.toThrow(
        /not configured.*STRIPE_\*/,
      );
    });
  });

  // ─── Normal operation when properly configured ─────────────────────────────

  describe('when properly configured', () => {
    it('creates a Pro checkout session with the Pro price id and metadata', async () => {
      const provider = await buildProvider(makeConfig());
      mockCheckoutSessionsCreate.mockResolvedValue({
        url: 'https://checkout.stripe.com/pro-session',
      });

      const result = await provider.createCheckoutSession(CHECKOUT_PARAMS);

      expect(mockCheckoutSessionsCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          mode: 'subscription',
          line_items: [{ price: 'price_pro_real123', quantity: 1 }],
          success_url: CHECKOUT_PARAMS.successUrl,
          cancel_url: CHECKOUT_PARAMS.cancelUrl,
          metadata: { internalUserId: 'user-1', plan: 'pro' },
        }),
      );
      expect(result).toEqual({ url: 'https://checkout.stripe.com/pro-session' });
    });

    it('creates a Student checkout session with the Student price id', async () => {
      const provider = await buildProvider(makeConfig());
      mockCheckoutSessionsCreate.mockResolvedValue({
        url: 'https://checkout.stripe.com/student-session',
      });

      await provider.createCheckoutSession({ ...CHECKOUT_PARAMS, plan: 'student' });

      expect(mockCheckoutSessionsCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          line_items: [{ price: 'price_student_real123', quantity: 1 }],
          metadata: { internalUserId: 'user-1', plan: 'student' },
        }),
      );
    });

    it('attaches an existing Stripe customer id when one is supplied', async () => {
      const provider = await buildProvider(makeConfig());
      mockCheckoutSessionsCreate.mockResolvedValue({ url: 'https://checkout.stripe.com/session' });

      await provider.createCheckoutSession({
        ...CHECKOUT_PARAMS,
        providerCustomerId: 'cus_existing',
      });

      expect(mockCheckoutSessionsCreate).toHaveBeenCalledWith(
        expect.objectContaining({ customer: 'cus_existing' }),
      );
    });

    it('creates a customer portal session', async () => {
      const provider = await buildProvider(makeConfig());
      mockPortalSessionsCreate.mockResolvedValue({
        url: 'https://billing.stripe.com/portal-session',
      });

      const result = await provider.createCustomerPortalSession({
        providerCustomerId: 'cus_1',
        returnUrl: 'https://app.example.com/dashboard',
      });

      expect(mockPortalSessionsCreate).toHaveBeenCalledWith({
        customer: 'cus_1',
        return_url: 'https://app.example.com/dashboard',
      });
      expect(result).toEqual({ url: 'https://billing.stripe.com/portal-session' });
    });

    it('verifies and maps a checkout.session.completed webhook event', async () => {
      const provider = await buildProvider(makeConfig());
      mockWebhooksConstructEvent.mockReturnValue({
        type: 'checkout.session.completed',
        data: {
          object: {
            mode: 'subscription',
            customer: 'cus_1',
            subscription: 'sub_1',
            currency: 'gbp',
            metadata: { internalUserId: 'user-1', plan: 'pro' },
            id: 'cs_1',
          },
        },
      });

      const result = provider.verifyAndParseWebhook({
        rawBody: Buffer.from('{}'),
        signature: 'sig',
      });

      expect(result).toEqual(
        expect.objectContaining({
          type: 'subscription.activated',
          provider: 'STRIPE',
          providerCustomerId: 'cus_1',
          providerSubscriptionId: 'sub_1',
          plan: 'pro',
        }),
      );
    });

    it('throws BadRequestException for an invalid webhook signature', async () => {
      const provider = await buildProvider(makeConfig());
      mockWebhooksConstructEvent.mockImplementation(() => {
        throw new Error('signature mismatch');
      });

      expect(() =>
        provider.verifyAndParseWebhook({ rawBody: Buffer.from('{}'), signature: 'bad-sig' }),
      ).toThrow(BadRequestException);
    });

    it('cancels a subscription', async () => {
      const provider = await buildProvider(makeConfig());
      mockSubscriptionsCancel.mockResolvedValue(undefined);

      await provider.cancelSubscription('sub_1');

      expect(mockSubscriptionsCancel).toHaveBeenCalledWith('sub_1');
    });
  });
});
