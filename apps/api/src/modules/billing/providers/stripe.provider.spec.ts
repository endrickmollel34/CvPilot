import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { Logger, ServiceUnavailableException, BadRequestException } from '@nestjs/common';

import { StripePaymentProvider } from './stripe.provider';

// stripe is a real HTTP client constructed directly in the provider's
// constructor — mocked here so tests never make network calls. It exports
// its client as a plain callable (no __esModule marker), so a bare jest.fn()
// constructor mock matches its real shape under esModuleInterop.
const mockCheckoutSessionsCreate = jest.fn();
const mockPortalSessionsCreate = jest.fn();
const mockWebhooksConstructEvent = jest.fn();
const mockSubscriptionsCancel = jest.fn();
// Stripe explicitly does not guarantee webhook delivery order (see
// docs.stripe.com/webhooks#event-ordering) — the provider re-fetches the
// live subscription rather than trusting the payload embedded in a
// customer.subscription.updated event, so every test for that event type
// must mock this, not just the webhook payload.
const mockSubscriptionsRetrieve = jest.fn();

jest.mock('stripe', () =>
  jest.fn().mockImplementation(() => ({
    checkout: { sessions: { create: (...args: unknown[]) => mockCheckoutSessionsCreate(...args) } },
    billingPortal: {
      sessions: { create: (...args: unknown[]) => mockPortalSessionsCreate(...args) },
    },
    webhooks: { constructEvent: (...args: unknown[]) => mockWebhooksConstructEvent(...args) },
    subscriptions: {
      cancel: (...args: unknown[]) => mockSubscriptionsCancel(...args),
      retrieve: (...args: unknown[]) => mockSubscriptionsRetrieve(...args),
    },
  })),
);

// A representative live Stripe.Subscription as returned by
// stripe.subscriptions.retrieve() — this is what the provider now derives
// every customer.subscription.updated field from, never the webhook's own
// embedded (possibly stale/out-of-order) event.data.object snapshot.
function liveSubscription(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sub_1',
    customer: 'cus_1',
    status: 'active',
    cancel_at_period_end: false,
    items: {
      data: [
        {
          price: { id: 'price_pro_real123' },
          current_period_start: 1_700_000_000,
          current_period_end: 1_702_592_000,
        },
      ],
    },
    ...overrides,
  };
}

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

      await expect(
        provider.verifyAndParseWebhook({ rawBody: Buffer.from('{}'), signature: 'sig' }),
      ).rejects.toThrow(ServiceUnavailableException);
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

      const result = await provider.verifyAndParseWebhook({
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

    it.each([
      ['active', 'active'],
      ['past_due', 'past_due'],
      ['canceled', 'cancelled'],
      ['trialing', 'trialing'],
      ['unpaid', 'incomplete'], // anything unrecognised falls back to 'incomplete'
    ])(
      'maps a customer.subscription.updated event with Stripe status "%s" to "%s"',
      async (stripeStatus, expectedStatus) => {
        const provider = await buildProvider(makeConfig());
        // The embedded webhook payload only needs to carry the subscription
        // id — every other field is deliberately NOT set here, to prove the
        // result comes from the live re-fetch below, not this snapshot.
        mockWebhooksConstructEvent.mockReturnValue({
          id: 'evt_1',
          type: 'customer.subscription.updated',
          data: { object: { id: 'sub_1' } },
        });
        mockSubscriptionsRetrieve.mockResolvedValue(
          liveSubscription({ status: stripeStatus, cancel_at_period_end: false }),
        );

        const result = await provider.verifyAndParseWebhook({
          rawBody: Buffer.from('{}'),
          signature: 'sig',
        });

        expect(mockSubscriptionsRetrieve).toHaveBeenCalledWith('sub_1');
        expect(result).toEqual(
          expect.objectContaining({
            type: 'subscription.updated',
            providerCustomerId: 'cus_1',
            providerSubscriptionId: 'sub_1',
            plan: 'pro',
            subscriptionStatus: expectedStatus,
            cancelAtPeriodEnd: false,
            currentPeriodStart: new Date(1_700_000_000 * 1000),
            currentPeriodEnd: new Date(1_702_592_000 * 1000),
          }),
        );
      },
    );

    it('maps a customer.subscription.updated event with cancel_at_period_end true', async () => {
      const provider = await buildProvider(makeConfig());
      mockWebhooksConstructEvent.mockReturnValue({
        id: 'evt_2',
        type: 'customer.subscription.updated',
        data: { object: { id: 'sub_1' } },
      });
      mockSubscriptionsRetrieve.mockResolvedValue(
        liveSubscription({
          cancel_at_period_end: true,
          items: {
            data: [
              {
                price: { id: 'price_student_real123' },
                current_period_start: 1_700_000_000,
                current_period_end: 1_702_592_000,
              },
            ],
          },
        }),
      );

      const result = await provider.verifyAndParseWebhook({
        rawBody: Buffer.from('{}'),
        signature: 'sig',
      });

      expect(result).toEqual(
        expect.objectContaining({
          plan: 'student',
          subscriptionStatus: 'active',
          cancelAtPeriodEnd: true,
        }),
      );
    });

    it('maps an unrecognised price id on customer.subscription.updated to plan "free"', async () => {
      const provider = await buildProvider(makeConfig());
      mockWebhooksConstructEvent.mockReturnValue({
        id: 'evt_3',
        type: 'customer.subscription.updated',
        data: { object: { id: 'sub_1' } },
      });
      mockSubscriptionsRetrieve.mockResolvedValue(
        liveSubscription({
          items: {
            data: [
              {
                price: { id: 'price_unknown' },
                current_period_start: 1_700_000_000,
                current_period_end: 1_702_592_000,
              },
            ],
          },
        }),
      );

      const result = await provider.verifyAndParseWebhook({
        rawBody: Buffer.from('{}'),
        signature: 'sig',
      });

      expect(result).toEqual(expect.objectContaining({ plan: 'free' }));
    });

    it('omits currentPeriodStart/End on customer.subscription.updated when the subscription has no items', async () => {
      const provider = await buildProvider(makeConfig());
      mockWebhooksConstructEvent.mockReturnValue({
        id: 'evt_4',
        type: 'customer.subscription.updated',
        data: { object: { id: 'sub_1' } },
      });
      mockSubscriptionsRetrieve.mockResolvedValue(liveSubscription({ items: { data: [] } }));

      const result = await provider.verifyAndParseWebhook({
        rawBody: Buffer.from('{}'),
        signature: 'sig',
      });

      expect(result).not.toHaveProperty('currentPeriodStart');
      expect(result).not.toHaveProperty('currentPeriodEnd');
    });

    // ─── Out-of-order webhook delivery (production incident regression) ────────
    // Stripe explicitly does not guarantee delivery order and explicitly warns
    // against relying on event.created to reconcile it (distinct events can
    // share the same second) — docs.stripe.com/webhooks#event-ordering. A
    // real production incident: cancelling via the Customer Portal produced
    // two customer.subscription.updated deliveries ~1 second apart; the one
    // whose OWN embedded payload still said cancel_at_period_end: false was
    // processed after the one saying true, and a plain last-write-wins
    // persist of the embedded snapshot silently reverted the cancellation in
    // our DB. The fix: never trust the embedded snapshot — re-fetch the live
    // subscription and derive the result from that instead, which is
    // order-independent by construction (any processing order converges on
    // the same live state).

    it('uses the LIVE Stripe subscription for cancelAtPeriodEnd, not the embedded webhook payload — regression test for the production incident where a stale out-of-order delivery reverted a real cancellation', async () => {
      const provider = await buildProvider(makeConfig());
      mockWebhooksConstructEvent.mockReturnValue({
        id: 'evt_stale',
        type: 'customer.subscription.updated',
        data: {
          object: {
            id: 'sub_1',
            // Stale/lagging embedded snapshot — must be ignored entirely.
            cancel_at_period_end: false,
          },
        },
      });
      mockSubscriptionsRetrieve.mockResolvedValue(liveSubscription({ cancel_at_period_end: true }));

      const result = await provider.verifyAndParseWebhook({
        rawBody: Buffer.from('{}'),
        signature: 'sig',
      });

      expect(result).toEqual(expect.objectContaining({ cancelAtPeriodEnd: true }));
    });

    it('also uses the live state when the embedded payload OVER-reports cancellation — proves order-independence, not just a one-directional bias toward true', async () => {
      const provider = await buildProvider(makeConfig());
      mockWebhooksConstructEvent.mockReturnValue({
        id: 'evt_stale_2',
        type: 'customer.subscription.updated',
        data: { object: { id: 'sub_1', cancel_at_period_end: true } },
      });
      mockSubscriptionsRetrieve.mockResolvedValue(
        liveSubscription({ cancel_at_period_end: false }),
      );

      const result = await provider.verifyAndParseWebhook({
        rawBody: Buffer.from('{}'),
        signature: 'sig',
      });

      expect(result).toEqual(expect.objectContaining({ cancelAtPeriodEnd: false }));
    });

    it('re-fetches using the subscription id carried by the webhook event, not a stale/previous id', async () => {
      const provider = await buildProvider(makeConfig());
      mockWebhooksConstructEvent.mockReturnValue({
        id: 'evt_5',
        type: 'customer.subscription.updated',
        data: { object: { id: 'sub_specific_id' } },
      });
      mockSubscriptionsRetrieve.mockResolvedValue(liveSubscription({ id: 'sub_specific_id' }));

      await provider.verifyAndParseWebhook({ rawBody: Buffer.from('{}'), signature: 'sig' });

      expect(mockSubscriptionsRetrieve).toHaveBeenCalledWith('sub_specific_id');
    });

    // ─── cancel_at-based period-end cancellation (2026-09-03 incident) ─────────
    // Definitive production evidence: for a Pro subscription the Stripe
    // Dashboard displayed as "Cancels Oct 3, 2026", the real
    // customer.subscription.updated payload was:
    //   status: "active", cancel_at_period_end: false,
    //   cancel_at: 1791043725, canceled_at: 1788457549,
    //   cancellation_details.reason: "cancellation_requested",
    //   items.data[0].current_period_end: 1791043725, schedule: null
    // cancel_at_period_end: false yet cancel_at === current_period_end. Under
    // CVPilot's current Stripe API version/billing mode, the Customer
    // Portal's period-end cancellation flow apparently represents this via
    // `cancel_at` rather than the classic boolean. The commit c4022b7 live
    // re-fetch fix alone was not sufficient — it correctly fetches the live
    // object, but the live object's OWN cancel_at_period_end is false here,
    // so a direct-mirror mapping still produced the wrong (false) result.

    it('treats cancel_at equal to the current period end as a period-end cancellation — exact production incident payload', async () => {
      const provider = await buildProvider(makeConfig());
      mockWebhooksConstructEvent.mockReturnValue({
        id: 'evt_cancel_at',
        type: 'customer.subscription.updated',
        data: { object: { id: 'sub_1' } },
      });
      mockSubscriptionsRetrieve.mockResolvedValue(
        liveSubscription({
          status: 'active',
          cancel_at_period_end: false,
          cancel_at: 1_791_043_725,
          canceled_at: 1_788_457_549,
          cancellation_details: { reason: 'cancellation_requested' },
          schedule: null,
          items: {
            data: [
              {
                price: { id: 'price_pro_real123' },
                current_period_start: 1_788_451_725,
                current_period_end: 1_791_043_725,
              },
            ],
          },
        }),
      );

      const result = await provider.verifyAndParseWebhook({
        rawBody: Buffer.from('{}'),
        signature: 'sig',
      });

      expect(result).toEqual(
        expect.objectContaining({
          subscriptionStatus: 'active',
          cancelAtPeriodEnd: true,
          cancelAt: new Date(1_791_043_725 * 1000),
          currentPeriodEnd: new Date(1_791_043_725 * 1000),
        }),
      );
    });

    it('does not classify as a period-end cancellation when cancel_at is null and cancel_at_period_end is false', async () => {
      const provider = await buildProvider(makeConfig());
      mockWebhooksConstructEvent.mockReturnValue({
        id: 'evt_no_cancel',
        type: 'customer.subscription.updated',
        data: { object: { id: 'sub_1' } },
      });
      mockSubscriptionsRetrieve.mockResolvedValue(
        liveSubscription({ cancel_at_period_end: false, cancel_at: null }),
      );

      const result = await provider.verifyAndParseWebhook({
        rawBody: Buffer.from('{}'),
        signature: 'sig',
      });

      expect(result).toEqual(expect.objectContaining({ cancelAtPeriodEnd: false }));
      expect(result).not.toHaveProperty('cancelAt');
    });

    it('is true when cancel_at_period_end is true, independent of cancel_at', async () => {
      const provider = await buildProvider(makeConfig());
      mockWebhooksConstructEvent.mockReturnValue({
        id: 'evt_classic',
        type: 'customer.subscription.updated',
        data: { object: { id: 'sub_1' } },
      });
      mockSubscriptionsRetrieve.mockResolvedValue(
        liveSubscription({ cancel_at_period_end: true, cancel_at: null }),
      );

      const result = await provider.verifyAndParseWebhook({
        rawBody: Buffer.from('{}'),
        signature: 'sig',
      });

      expect(result).toEqual(expect.objectContaining({ cancelAtPeriodEnd: true }));
    });

    it('does NOT blindly classify a cancel_at that differs from the current period end as a period-end cancellation', async () => {
      const provider = await buildProvider(makeConfig());
      mockWebhooksConstructEvent.mockReturnValue({
        id: 'evt_future_cancel',
        type: 'customer.subscription.updated',
        data: { object: { id: 'sub_1' } },
      });
      mockSubscriptionsRetrieve.mockResolvedValue(
        liveSubscription({
          cancel_at_period_end: false,
          // Scheduled to cancel at some future point that is NOT the current
          // period's end (e.g. a multi-period-out cancellation) — must not
          // be conflated with "ends at the current period boundary".
          cancel_at: 1_800_000_000,
          items: {
            data: [
              {
                price: { id: 'price_pro_real123' },
                current_period_start: 1_700_000_000,
                current_period_end: 1_702_592_000,
              },
            ],
          },
        }),
      );

      const result = await provider.verifyAndParseWebhook({
        rawBody: Buffer.from('{}'),
        signature: 'sig',
      });

      expect(result).toEqual(
        expect.objectContaining({
          cancelAtPeriodEnd: false,
          cancelAt: new Date(1_800_000_000 * 1000),
        }),
      );
    });

    it('does not treat a populated canceled_at as ended access while status remains active — exact production payload has both', async () => {
      const provider = await buildProvider(makeConfig());
      mockWebhooksConstructEvent.mockReturnValue({
        id: 'evt_canceled_at',
        type: 'customer.subscription.updated',
        data: { object: { id: 'sub_1' } },
      });
      mockSubscriptionsRetrieve.mockResolvedValue(
        liveSubscription({
          status: 'active',
          cancel_at_period_end: false,
          cancel_at: null,
          // canceled_at populated (cancellation requested) while the
          // subscription is still fully active/entitled — must not by
          // itself flip cancelAtPeriodEnd or subscriptionStatus.
          canceled_at: 1_788_457_549,
        }),
      );

      const result = await provider.verifyAndParseWebhook({
        rawBody: Buffer.from('{}'),
        signature: 'sig',
      });

      expect(result).toEqual(
        expect.objectContaining({ subscriptionStatus: 'active', cancelAtPeriodEnd: false }),
      );
    });

    it('maps a customer.subscription.deleted event to subscription.cancelled', async () => {
      const provider = await buildProvider(makeConfig());
      mockWebhooksConstructEvent.mockReturnValue({
        type: 'customer.subscription.deleted',
        data: {
          object: {
            id: 'sub_1',
            customer: 'cus_1',
          },
        },
      });

      const result = await provider.verifyAndParseWebhook({
        rawBody: Buffer.from('{}'),
        signature: 'sig',
      });

      expect(result).toEqual({
        type: 'subscription.cancelled',
        provider: 'STRIPE',
        providerCustomerId: 'cus_1',
        providerSubscriptionId: 'sub_1',
        subscriptionStatus: 'cancelled',
      });
    });

    it('maps an invoice.payment_succeeded event with amount and currency', async () => {
      const provider = await buildProvider(makeConfig());
      mockWebhooksConstructEvent.mockReturnValue({
        type: 'invoice.payment_succeeded',
        data: {
          object: {
            id: 'in_1',
            customer: 'cus_1',
            // Since basil, invoice.subscription no longer exists — the
            // generating subscription now lives at
            // parent.subscription_details.subscription. See
            // docs.stripe.com/changelog/basil/2025-03-31/
            // adds-new-parent-field-to-invoicing-objects.
            parent: {
              type: 'subscription_details',
              subscription_details: { subscription: 'sub_1' },
            },
            amount_paid: 999,
            currency: 'gbp',
          },
        },
      });

      const result = await provider.verifyAndParseWebhook({
        rawBody: Buffer.from('{}'),
        signature: 'sig',
      });

      expect(result).toEqual({
        type: 'payment.succeeded',
        provider: 'STRIPE',
        providerCustomerId: 'cus_1',
        providerSubscriptionId: 'sub_1',
        // Since basil, invoice.payment_intent no longer exists (an invoice can
        // settle via multiple partial payments now) — the invoice's own id is
        // the stable idempotency key instead.
        providerPaymentId: 'in_1',
        paymentStatus: 'succeeded',
        paymentMethod: 'CARD',
        amountMinorUnits: 999,
        currency: 'GBP',
      });
    });

    it('maps an invoice.payment_succeeded event with no parent (manually created invoice) to an undefined subscription id', async () => {
      const provider = await buildProvider(makeConfig());
      mockWebhooksConstructEvent.mockReturnValue({
        type: 'invoice.payment_succeeded',
        data: {
          object: {
            id: 'in_2',
            customer: 'cus_1',
            parent: null,
            amount_paid: 500,
            currency: 'gbp',
          },
        },
      });

      const result = await provider.verifyAndParseWebhook({
        rawBody: Buffer.from('{}'),
        signature: 'sig',
      });

      expect(result).toEqual(
        expect.objectContaining({
          providerSubscriptionId: undefined,
          providerPaymentId: 'in_2',
        }),
      );
    });

    it('maps an invoice.payment_failed event', async () => {
      const provider = await buildProvider(makeConfig());
      mockWebhooksConstructEvent.mockReturnValue({
        type: 'invoice.payment_failed',
        data: {
          object: {
            id: 'in_3',
            customer: 'cus_1',
            parent: {
              type: 'subscription_details',
              subscription_details: { subscription: 'sub_1' },
            },
          },
        },
      });

      const result = await provider.verifyAndParseWebhook({
        rawBody: Buffer.from('{}'),
        signature: 'sig',
      });

      expect(result).toEqual({
        type: 'payment.failed',
        provider: 'STRIPE',
        providerCustomerId: 'cus_1',
        providerSubscriptionId: 'sub_1',
        paymentStatus: 'failed',
      });
    });

    it('returns null for an unhandled Stripe event type', async () => {
      const provider = await buildProvider(makeConfig());
      mockWebhooksConstructEvent.mockReturnValue({
        type: 'customer.updated',
        data: { object: {} },
      });

      const result = await provider.verifyAndParseWebhook({
        rawBody: Buffer.from('{}'),
        signature: 'sig',
      });

      expect(result).toBeNull();
    });

    it('throws BadRequestException for an invalid webhook signature', async () => {
      const provider = await buildProvider(makeConfig());
      mockWebhooksConstructEvent.mockImplementation(() => {
        throw new Error('signature mismatch');
      });

      await expect(
        provider.verifyAndParseWebhook({ rawBody: Buffer.from('{}'), signature: 'bad-sig' }),
      ).rejects.toThrow(BadRequestException);
    });

    // ─── Diagnostics (Production Readiness Phase 1) ──────────────────────────
    // A misconfigured/rotated STRIPE_WEBHOOK_SECRET must leave a trace —
    // previously this failure was completely silent server-side.

    it('logs a warning with the verification-failure reason when the signature is invalid', async () => {
      const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      const provider = await buildProvider(makeConfig());
      mockWebhooksConstructEvent.mockImplementation(() => {
        throw new Error('No signatures found matching the expected signature for payload');
      });

      try {
        await provider.verifyAndParseWebhook({
          rawBody: Buffer.from('{"secret":"do-not-log-me"}'),
          signature: 'super-secret-signature-value',
        });
      } catch {
        // BadRequestException is already asserted separately above.
      }

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('No signatures found matching the expected signature for payload'),
      );

      warnSpy.mockRestore();
    });

    it('never logs the raw body, signature header, or webhook secret on verification failure', async () => {
      const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      const provider = await buildProvider(makeConfig());
      mockWebhooksConstructEvent.mockImplementation(() => {
        throw new Error('Timestamp outside the tolerance zone');
      });

      try {
        await provider.verifyAndParseWebhook({
          rawBody: Buffer.from('{"secret":"do-not-log-me"}'),
          signature: 'super-secret-signature-value',
        });
      } catch {
        // expected
      }

      const loggedText = warnSpy.mock.calls.map((call) => String(call[0])).join('\n');
      expect(loggedText).not.toContain('do-not-log-me');
      expect(loggedText).not.toContain('super-secret-signature-value');
      expect(loggedText).not.toContain('whsec_real123'); // STRIPE_WEBHOOK_SECRET from makeConfig()

      warnSpy.mockRestore();
    });

    it('cancels a subscription', async () => {
      const provider = await buildProvider(makeConfig());
      mockSubscriptionsCancel.mockResolvedValue(undefined);

      await provider.cancelSubscription('sub_1');

      expect(mockSubscriptionsCancel).toHaveBeenCalledWith('sub_1');
    });
  });
});
