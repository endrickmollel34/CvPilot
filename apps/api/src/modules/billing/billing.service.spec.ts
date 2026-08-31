import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException } from '@nestjs/common';
import { In, Not } from 'typeorm';

import type { Plan, SubscriptionStatus } from '@cvpilot/shared';
import { BillingService } from './billing.service';
import { StripePaymentProvider } from './providers/stripe.provider';
import { SubscriptionEntity } from '../../entities/subscription.entity';
import { PaymentEntity } from '../../entities/payment.entity';
import { AnalysisEntity } from '../../entities/analysis.entity';
import { CoverLetterEntity } from '../../entities/cover-letter.entity';
import { TailoringEntity } from '../../entities/tailoring.entity';
import { CvEntity } from '../../entities/cv.entity';
import { UserService } from '../user/user.service';

const MOCK_USER = { id: 'user-1', clerkId: 'clerk-1' };

function mockSub(plan: Plan, status: SubscriptionStatus, extra: Record<string, unknown> = {}) {
  return { userId: 'user-1', providerCustomerId: 'cus_1', plan, status, ...extra };
}

describe('BillingService', () => {
  let service: BillingService;

  const mockSubscriptionRepo = { findOneBy: jest.fn(), update: jest.fn(), upsert: jest.fn() };
  const mockPaymentRepo = { upsert: jest.fn() };
  const mockAnalysisRepo = { count: jest.fn() };
  const mockCoverLetterRepo = { count: jest.fn() };
  const mockTailoringRepo = { count: jest.fn() };
  const mockCvRepo = { count: jest.fn() };
  const mockUserService = { findByClerkId: jest.fn() };
  const mockStripeProvider = {
    providerType: 'STRIPE' as const,
    createCheckoutSession: jest.fn(),
    createCustomerPortalSession: jest.fn(),
    verifyAndParseWebhook: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BillingService,
        { provide: getRepositoryToken(SubscriptionEntity), useValue: mockSubscriptionRepo },
        { provide: getRepositoryToken(PaymentEntity), useValue: mockPaymentRepo },
        { provide: getRepositoryToken(AnalysisEntity), useValue: mockAnalysisRepo },
        { provide: getRepositoryToken(CoverLetterEntity), useValue: mockCoverLetterRepo },
        { provide: getRepositoryToken(TailoringEntity), useValue: mockTailoringRepo },
        { provide: getRepositoryToken(CvEntity), useValue: mockCvRepo },
        { provide: UserService, useValue: mockUserService },
        { provide: StripePaymentProvider, useValue: mockStripeProvider },
      ],
    }).compile();

    service = module.get<BillingService>(BillingService);

    mockUserService.findByClerkId.mockResolvedValue(MOCK_USER);
  });

  // ─── createCheckoutSession() — this is the exact method the fixed frontend ──
  // now calls for the first time; it previously had zero test coverage.

  describe('createCheckoutSession()', () => {
    it('creates a checkout session for a new (never-subscribed) user without a providerCustomerId', async () => {
      mockSubscriptionRepo.findOneBy.mockResolvedValue(null);
      mockStripeProvider.createCheckoutSession.mockResolvedValue({
        url: 'https://checkout.stripe.com/session-1',
      });

      const result = await service.createCheckoutSession('clerk-1', 'pro');

      expect(mockStripeProvider.createCheckoutSession).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-1',
          providerCustomerId: undefined,
          plan: 'pro',
          currency: 'GBP',
        }),
      );
      expect(result).toEqual({ url: 'https://checkout.stripe.com/session-1' });
    });

    it('creates a student checkout session with plan "student"', async () => {
      mockSubscriptionRepo.findOneBy.mockResolvedValue(null);
      mockStripeProvider.createCheckoutSession.mockResolvedValue({
        url: 'https://checkout.stripe.com/session-2',
      });

      await service.createCheckoutSession('clerk-1', 'student');

      expect(mockStripeProvider.createCheckoutSession).toHaveBeenCalledWith(
        expect.objectContaining({ plan: 'student' }),
      );
    });

    it('reuses the existing Stripe customer when the user already has a subscription record', async () => {
      // Covers "already-Pro user clicks Start Pro again" — Stripe should
      // reuse the same customer rather than creating a duplicate one.
      mockSubscriptionRepo.findOneBy.mockResolvedValue({
        userId: 'user-1',
        providerCustomerId: 'cus_existing123',
        plan: 'pro',
      });
      mockStripeProvider.createCheckoutSession.mockResolvedValue({
        url: 'https://checkout.stripe.com/session-3',
      });

      await service.createCheckoutSession('clerk-1', 'pro');

      expect(mockStripeProvider.createCheckoutSession).toHaveBeenCalledWith(
        expect.objectContaining({ providerCustomerId: 'cus_existing123' }),
      );
    });

    it('includes dashboard success/cancel URLs', async () => {
      mockSubscriptionRepo.findOneBy.mockResolvedValue(null);
      mockStripeProvider.createCheckoutSession.mockResolvedValue({
        url: 'https://checkout.stripe.com/session-4',
      });

      await service.createCheckoutSession('clerk-1', 'pro');

      expect(mockStripeProvider.createCheckoutSession).toHaveBeenCalledWith(
        expect.objectContaining({
          successUrl: expect.stringContaining('/dashboard?checkout=success'),
          cancelUrl: expect.stringContaining('/dashboard?checkout=cancelled'),
        }),
      );
    });

    it('throws BadRequestException for an unknown payment provider', async () => {
      mockSubscriptionRepo.findOneBy.mockResolvedValue(null);

      await expect(service.createCheckoutSession('clerk-1', 'pro', 'CLICKPESA')).rejects.toThrow(
        BadRequestException,
      );
      expect(mockStripeProvider.createCheckoutSession).not.toHaveBeenCalled();
    });

    it('propagates a configuration error from the provider (e.g. placeholder Stripe env vars)', async () => {
      mockSubscriptionRepo.findOneBy.mockResolvedValue(null);
      mockStripeProvider.createCheckoutSession.mockRejectedValue(
        new Error('Payments are not configured for this environment.'),
      );

      await expect(service.createCheckoutSession('clerk-1', 'pro')).rejects.toThrow(
        'Payments are not configured for this environment.',
      );
    });
  });

  // ─── getUserPlan() — effective plan resolution (entitlement bug fix) ───────
  // This is the real BillingService logic, not a mock — every case here
  // mirrors the rules from the investigation report.

  describe('getUserPlan()', () => {
    it('returns free when the user has no subscription row at all', async () => {
      mockSubscriptionRepo.findOneBy.mockResolvedValue(null);
      await expect(service.getUserPlan('user-1')).resolves.toBe('free');
    });

    it('returns free when the stored plan is free, regardless of status', async () => {
      mockSubscriptionRepo.findOneBy.mockResolvedValue(mockSub('free', 'active'));
      await expect(service.getUserPlan('user-1')).resolves.toBe('free');
    });

    it('returns pro for an active Pro subscription', async () => {
      mockSubscriptionRepo.findOneBy.mockResolvedValue(mockSub('pro', 'active'));
      await expect(service.getUserPlan('user-1')).resolves.toBe('pro');
    });

    it('returns student for an active Student subscription', async () => {
      mockSubscriptionRepo.findOneBy.mockResolvedValue(mockSub('student', 'active'));
      await expect(service.getUserPlan('user-1')).resolves.toBe('student');
    });

    it('retains paid access for a trialing Pro subscription', async () => {
      mockSubscriptionRepo.findOneBy.mockResolvedValue(mockSub('pro', 'trialing'));
      await expect(service.getUserPlan('user-1')).resolves.toBe('pro');
    });

    it('retains paid access for a trialing Student subscription', async () => {
      mockSubscriptionRepo.findOneBy.mockResolvedValue(mockSub('student', 'trialing'));
      await expect(service.getUserPlan('user-1')).resolves.toBe('student');
    });

    it('downgrades a past_due Pro subscription to free-level entitlements', async () => {
      mockSubscriptionRepo.findOneBy.mockResolvedValue(mockSub('pro', 'past_due'));
      await expect(service.getUserPlan('user-1')).resolves.toBe('free');
    });

    it('downgrades a past_due Student subscription to free-level entitlements', async () => {
      mockSubscriptionRepo.findOneBy.mockResolvedValue(mockSub('student', 'past_due'));
      await expect(service.getUserPlan('user-1')).resolves.toBe('free');
    });

    it('downgrades an incomplete Pro subscription to free-level entitlements', async () => {
      mockSubscriptionRepo.findOneBy.mockResolvedValue(mockSub('pro', 'incomplete'));
      await expect(service.getUserPlan('user-1')).resolves.toBe('free');
    });

    it('downgrades a cancelled Pro subscription to free-level entitlements', async () => {
      // Defense in depth: onSubscriptionCancelled already resets plan to
      // 'free' in storage, but effective-plan resolution must not silently
      // trust a stale 'pro'+'cancelled' row if one ever exists.
      mockSubscriptionRepo.findOneBy.mockResolvedValue(mockSub('pro', 'cancelled'));
      await expect(service.getUserPlan('user-1')).resolves.toBe('free');
    });

    it('retains paid access while active with cancelAtPeriodEnd set (cancellation scheduled, not yet effective)', async () => {
      mockSubscriptionRepo.findOneBy.mockResolvedValue(
        mockSub('pro', 'active', { cancelAtPeriodEnd: true }),
      );
      await expect(service.getUserPlan('user-1')).resolves.toBe('pro');
    });
  });

  // ─── canPerformAction() — entitlement enforcement end-to-end ───────────────

  describe('canPerformAction()', () => {
    it('allows unlimited analyses for an active Pro subscription regardless of usage', async () => {
      mockSubscriptionRepo.findOneBy.mockResolvedValue(mockSub('pro', 'active'));
      mockAnalysisRepo.count.mockResolvedValue(999);

      await expect(service.canPerformAction('user-1', 'analyse')).resolves.toBe(true);
    });

    it('allows unlimited cover letters for an active Student subscription regardless of usage', async () => {
      mockSubscriptionRepo.findOneBy.mockResolvedValue(mockSub('student', 'active'));
      mockCoverLetterRepo.count.mockResolvedValue(999);

      await expect(service.canPerformAction('user-1', 'cover-letter')).resolves.toBe(true);
    });

    it('allows unlimited analyses for a trialing Pro subscription', async () => {
      mockSubscriptionRepo.findOneBy.mockResolvedValue(mockSub('pro', 'trialing'));
      mockAnalysisRepo.count.mockResolvedValue(999);

      await expect(service.canPerformAction('user-1', 'analyse')).resolves.toBe(true);
    });

    it('enforces the Free analysesPerMonth limit on a past_due Pro subscription — the core bug this fix closes', async () => {
      mockSubscriptionRepo.findOneBy.mockResolvedValue(mockSub('pro', 'past_due'));
      mockAnalysisRepo.count.mockResolvedValue(2); // Free limit is 2

      await expect(service.canPerformAction('user-1', 'analyse')).resolves.toBe(false);
    });

    it('enforces the Free coverLettersPerMonth limit on an incomplete Student subscription', async () => {
      mockSubscriptionRepo.findOneBy.mockResolvedValue(mockSub('student', 'incomplete'));
      mockCoverLetterRepo.count.mockResolvedValue(1); // Free limit is 1

      await expect(service.canPerformAction('user-1', 'cover-letter')).resolves.toBe(false);
    });

    it('allows a Free-plan user under the analysesPerMonth boundary', async () => {
      mockSubscriptionRepo.findOneBy.mockResolvedValue(null);
      mockAnalysisRepo.count.mockResolvedValue(1); // below the limit of 2

      await expect(service.canPerformAction('user-1', 'analyse')).resolves.toBe(true);
    });

    it('blocks a Free-plan user exactly at the analysesPerMonth boundary', async () => {
      mockSubscriptionRepo.findOneBy.mockResolvedValue(null);
      mockAnalysisRepo.count.mockResolvedValue(2); // at the limit of 2

      await expect(service.canPerformAction('user-1', 'analyse')).resolves.toBe(false);
    });

    it('allows a Free-plan user under the coverLettersPerMonth boundary', async () => {
      mockSubscriptionRepo.findOneBy.mockResolvedValue(null);
      mockCoverLetterRepo.count.mockResolvedValue(0); // below the limit of 1

      await expect(service.canPerformAction('user-1', 'cover-letter')).resolves.toBe(true);
    });

    it('blocks a Free-plan user exactly at the coverLettersPerMonth boundary', async () => {
      mockSubscriptionRepo.findOneBy.mockResolvedValue(null);
      mockCoverLetterRepo.count.mockResolvedValue(1); // at the limit of 1

      await expect(service.canPerformAction('user-1', 'cover-letter')).resolves.toBe(false);
    });

    // ─── Failed AI generations must not consume quota ────────────────────────
    // A transient OpenAI/Anthropic outage previously burned a Free user's
    // tiny monthly allowance for zero result, because the count query
    // included status: 'failed' rows. Mirrors TailoringService's existing
    // Not('failed') exclusion.

    it('excludes failed rows from the analysesPerMonth count query', async () => {
      mockSubscriptionRepo.findOneBy.mockResolvedValue(null); // Free plan
      mockAnalysisRepo.count.mockResolvedValue(0);

      await service.canPerformAction('user-1', 'analyse');

      expect(mockAnalysisRepo.count).toHaveBeenCalledWith({
        where: expect.objectContaining({ status: Not('failed') }),
      });
    });

    it('excludes failed rows from the coverLettersPerMonth count query', async () => {
      mockSubscriptionRepo.findOneBy.mockResolvedValue(null); // Free plan
      mockCoverLetterRepo.count.mockResolvedValue(0);

      await service.canPerformAction('user-1', 'cover-letter');

      expect(mockCoverLetterRepo.count).toHaveBeenCalledWith({
        where: expect.objectContaining({ status: Not('failed') }),
      });
    });

    it('allows a Free user whose only prior attempt this month failed (successful/non-failed count is 0)', async () => {
      // Models: 1 failed analysis exists this month, but the Not('failed')
      // query correctly reports a non-failed count of 0 — the failed
      // attempt did not consume the user's quota.
      mockSubscriptionRepo.findOneBy.mockResolvedValue(null);
      mockAnalysisRepo.count.mockResolvedValue(0);

      await expect(service.canPerformAction('user-1', 'analyse')).resolves.toBe(true);
    });

    it('blocks a Free user once non-failed analyses reach the limit, regardless of additional failed attempts', async () => {
      // Models: 2 successful analyses plus several failed ones this month —
      // the Not('failed') query reports 2 (the real, non-failed count),
      // which correctly hits the Free limit of 2.
      mockSubscriptionRepo.findOneBy.mockResolvedValue(null);
      mockAnalysisRepo.count.mockResolvedValue(2);

      await expect(service.canPerformAction('user-1', 'analyse')).resolves.toBe(false);
      expect(mockAnalysisRepo.count).toHaveBeenCalledWith({
        where: expect.objectContaining({ status: Not('failed'), userId: 'user-1' }),
      });
    });

    it('blocks a Free user once non-failed cover letters reach the limit, regardless of additional failed attempts', async () => {
      // Models: 1 successful cover letter plus a failed one this month —
      // the Not('failed') query reports 1 (the real, non-failed count),
      // which correctly hits the Free limit of 1.
      mockSubscriptionRepo.findOneBy.mockResolvedValue(null);
      mockCoverLetterRepo.count.mockResolvedValue(1);

      await expect(service.canPerformAction('user-1', 'cover-letter')).resolves.toBe(false);
      expect(mockCoverLetterRepo.count).toHaveBeenCalledWith({
        where: expect.objectContaining({ status: Not('failed'), userId: 'user-1' }),
      });
    });
  });

  // ─── getUsageSummary() — usage visibility (never gated by dev bypass) ──────

  describe('getUsageSummary()', () => {
    beforeEach(() => {
      mockAnalysisRepo.count.mockResolvedValue(0);
      mockCoverLetterRepo.count.mockResolvedValue(0);
      mockTailoringRepo.count.mockResolvedValue(0);
      mockCvRepo.count.mockResolvedValue(0);
    });

    it('reports zero usage with correct Free limits for a brand-new user with no subscription row', async () => {
      mockSubscriptionRepo.findOneBy.mockResolvedValue(null);

      const result = await service.getUsageSummary('clerk-1');

      expect(result.plan).toBe('free');
      expect(result.rawPlan).toBeUndefined();
      expect(result.subscriptionStatus).toBeUndefined();
      expect(result.usage).toEqual({
        analyses: { used: 0, limit: 2, remaining: 2 },
        coverLetters: { used: 0, limit: 1, remaining: 1 },
        tailorings: { used: 0, limit: 0, remaining: 0 },
        builderCvs: { used: 0, limit: 1, remaining: 1 },
      });
    });

    it('reports partial usage for a Free user with some activity this month', async () => {
      mockSubscriptionRepo.findOneBy.mockResolvedValue(null);
      mockAnalysisRepo.count.mockResolvedValue(1);
      mockCoverLetterRepo.count.mockResolvedValue(0);
      mockCvRepo.count.mockResolvedValue(1);

      const result = await service.getUsageSummary('clerk-1');

      expect(result.usage.analyses).toEqual({ used: 1, limit: 2, remaining: 1 });
      expect(result.usage.coverLetters).toEqual({ used: 0, limit: 1, remaining: 1 });
      expect(result.usage.builderCvs).toEqual({ used: 1, limit: 1, remaining: 0 });
    });

    it('reports remaining: 0 (not negative) once a Free limit is exhausted', async () => {
      mockSubscriptionRepo.findOneBy.mockResolvedValue(null);
      mockAnalysisRepo.count.mockResolvedValue(2);
      mockCoverLetterRepo.count.mockResolvedValue(1);

      const result = await service.getUsageSummary('clerk-1');

      expect(result.usage.analyses).toEqual({ used: 2, limit: 2, remaining: 0 });
      expect(result.usage.coverLetters).toEqual({ used: 1, limit: 1, remaining: 0 });
    });

    it('excludes failed analyses, cover letters, and tailorings from the reported usage counts', async () => {
      mockSubscriptionRepo.findOneBy.mockResolvedValue(null);

      await service.getUsageSummary('clerk-1');

      expect(mockAnalysisRepo.count).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ status: Not('failed') }) }),
      );
      expect(mockCoverLetterRepo.count).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ status: Not('failed') }) }),
      );
      expect(mockTailoringRepo.count).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ status: Not('failed') }) }),
      );
    });

    it('reports unlimited (null limit/remaining) usage for an active Pro subscription', async () => {
      mockSubscriptionRepo.findOneBy.mockResolvedValue(mockSub('pro', 'active'));
      mockAnalysisRepo.count.mockResolvedValue(50);

      const result = await service.getUsageSummary('clerk-1');

      expect(result.plan).toBe('pro');
      expect(result.rawPlan).toBe('pro');
      expect(result.subscriptionStatus).toBe('active');
      expect(result.usage.analyses).toEqual({ used: 50, limit: null, remaining: null });
      expect(result.usage.coverLetters).toEqual({ used: 0, limit: null, remaining: null });
      expect(result.usage.tailorings).toEqual({ used: 0, limit: null, remaining: null });
      expect(result.usage.builderCvs).toEqual({ used: 0, limit: null, remaining: null });
    });

    it('reports unlimited (null limit/remaining) usage for an active Student subscription', async () => {
      mockSubscriptionRepo.findOneBy.mockResolvedValue(mockSub('student', 'active'));

      const result = await service.getUsageSummary('clerk-1');

      expect(result.plan).toBe('student');
      expect(result.usage.analyses.limit).toBeNull();
      expect(result.usage.tailorings.limit).toBeNull();
    });

    it('reports effective Free limits for a past_due Pro subscription record', async () => {
      mockSubscriptionRepo.findOneBy.mockResolvedValue(mockSub('pro', 'past_due'));
      mockAnalysisRepo.count.mockResolvedValue(2);

      const result = await service.getUsageSummary('clerk-1');

      // Effective plan drops to free, but the raw stored record is preserved
      // for display (e.g. "you're marked Pro but payment failed").
      expect(result.plan).toBe('free');
      expect(result.rawPlan).toBe('pro');
      expect(result.subscriptionStatus).toBe('past_due');
      expect(result.usage.analyses).toEqual({ used: 2, limit: 2, remaining: 0 });
    });

    it('reports unlimited usage for a trialing paid-plan subscription', async () => {
      mockSubscriptionRepo.findOneBy.mockResolvedValue(mockSub('pro', 'trialing'));

      const result = await service.getUsageSummary('clerk-1');

      expect(result.plan).toBe('pro');
      expect(result.usage.analyses.limit).toBeNull();
    });

    it('reports unlimited usage for an active subscription with cancelAtPeriodEnd set (not yet actually cancelled)', async () => {
      mockSubscriptionRepo.findOneBy.mockResolvedValue(
        mockSub('pro', 'active', { cancelAtPeriodEnd: true }),
      );

      const result = await service.getUsageSummary('clerk-1');

      expect(result.plan).toBe('pro');
      expect(result.usage.analyses.limit).toBeNull();
    });

    it('reports builder CV usage as a live slot count (source builder/prefill), not a lifetime creation counter', async () => {
      mockSubscriptionRepo.findOneBy.mockResolvedValue(null);
      mockCvRepo.count.mockResolvedValue(1);

      await service.getUsageSummary('clerk-1');

      expect(mockCvRepo.count).toHaveBeenCalledWith({
        where: { userId: 'user-1', source: In(['builder', 'prefill']) },
      });
    });

    it('never bypasses real usage counts in a dev-quota-bypass environment', async () => {
      const original = process.env['NODE_ENV'];
      process.env['NODE_ENV'] = 'development';
      try {
        mockSubscriptionRepo.findOneBy.mockResolvedValue(null);
        mockAnalysisRepo.count.mockResolvedValue(2); // at the Free limit

        const result = await service.getUsageSummary('clerk-1');

        // Real, exhausted usage is reported even though canPerformAction()
        // would bypass enforcement in this same environment.
        expect(result.usage.analyses).toEqual({ used: 2, limit: 2, remaining: 0 });
      } finally {
        process.env['NODE_ENV'] = original;
      }
    });
  });

  // ─── handleWebhook() — subscription state transitions ──────────────────────
  // These were previously untested: BillingService's event-application logic
  // (applyBillingEvent → onSubscription*/onPayment*) had zero direct
  // coverage before this fix.

  describe('handleWebhook() — subscription state transitions', () => {
    async function fireEvent(event: Record<string, unknown>) {
      mockStripeProvider.verifyAndParseWebhook.mockReturnValue(event);
      await service.handleWebhook('STRIPE', Buffer.from('{}'), 'sig');
    }

    it('subscription.activated upserts a new row keyed by userId', async () => {
      await fireEvent({
        type: 'subscription.activated',
        provider: 'STRIPE',
        providerCustomerId: 'cus_1',
        providerSubscriptionId: 'sub_1',
        plan: 'pro',
        subscriptionStatus: 'active',
        paymentMethod: 'CARD',
        metadata: { internalUserId: 'user-1' },
      });

      expect(mockSubscriptionRepo.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-1',
          providerCustomerId: 'cus_1',
          providerSubscriptionId: 'sub_1',
          plan: 'pro',
          status: 'active',
        }),
        { conflictPaths: ['userId'] },
      );
    });

    it('subscription.activated does nothing when userId is missing from metadata', async () => {
      await fireEvent({
        type: 'subscription.activated',
        provider: 'STRIPE',
        providerCustomerId: 'cus_1',
        plan: 'pro',
        metadata: {},
      });

      expect(mockSubscriptionRepo.upsert).not.toHaveBeenCalled();
    });

    it('subscription.updated applies plan, status, and period fields', async () => {
      await fireEvent({
        type: 'subscription.updated',
        provider: 'STRIPE',
        providerCustomerId: 'cus_1',
        plan: 'pro',
        subscriptionStatus: 'active',
        currentPeriodStart: new Date('2026-01-01'),
        currentPeriodEnd: new Date('2026-02-01'),
        cancelAtPeriodEnd: false,
      });

      expect(mockSubscriptionRepo.update).toHaveBeenCalledWith(
        { providerCustomerId: 'cus_1' },
        expect.objectContaining({
          plan: 'pro',
          status: 'active',
          currentPeriodStart: new Date('2026-01-01'),
          currentPeriodEnd: new Date('2026-02-01'),
          cancelAtPeriodEnd: false,
        }),
      );
    });

    it('subscription.updated with only cancelAtPeriodEnd does not touch plan or status (scheduled cancellation)', async () => {
      await fireEvent({
        type: 'subscription.updated',
        provider: 'STRIPE',
        providerCustomerId: 'cus_1',
        cancelAtPeriodEnd: true,
      });

      expect(mockSubscriptionRepo.update).toHaveBeenCalledWith(
        { providerCustomerId: 'cus_1' },
        { cancelAtPeriodEnd: true },
      );
    });

    it('subscription.updated restoring status to active reinstates paid entitlements (recovery from past_due)', async () => {
      await fireEvent({
        type: 'subscription.updated',
        provider: 'STRIPE',
        providerCustomerId: 'cus_1',
        subscriptionStatus: 'active',
      });

      expect(mockSubscriptionRepo.update).toHaveBeenCalledWith(
        { providerCustomerId: 'cus_1' },
        { status: 'active' },
      );

      // And the entitlement layer correctly reflects the restored row.
      mockSubscriptionRepo.findOneBy.mockResolvedValue(mockSub('pro', 'active'));
      await expect(service.getUserPlan('user-1')).resolves.toBe('pro');
    });

    it('subscription.cancelled (subscription deleted) resets status to cancelled and plan to free', async () => {
      await fireEvent({
        type: 'subscription.cancelled',
        provider: 'STRIPE',
        providerCustomerId: 'cus_1',
        subscriptionStatus: 'cancelled',
      });

      expect(mockSubscriptionRepo.update).toHaveBeenCalledWith(
        { providerCustomerId: 'cus_1' },
        { status: 'cancelled', plan: 'free', cancelAtPeriodEnd: false },
      );
    });

    it('payment.failed sets status to past_due without touching plan', async () => {
      await fireEvent({
        type: 'payment.failed',
        provider: 'STRIPE',
        providerCustomerId: 'cus_1',
        paymentStatus: 'failed',
      });

      expect(mockSubscriptionRepo.update).toHaveBeenCalledWith(
        { providerCustomerId: 'cus_1' },
        { status: 'past_due' },
      );
    });

    it('payment.succeeded records the payment and does not itself alter subscription status (recovery arrives via a paired subscription.updated event)', async () => {
      mockSubscriptionRepo.findOneBy.mockResolvedValue(mockSub('pro', 'past_due'));

      await fireEvent({
        type: 'payment.succeeded',
        provider: 'STRIPE',
        providerCustomerId: 'cus_1',
        providerPaymentId: 'pi_1',
        paymentStatus: 'succeeded',
        paymentMethod: 'CARD',
        amountMinorUnits: 999,
        currency: 'GBP',
      });

      expect(mockPaymentRepo.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-1',
          providerPaymentId: 'pi_1',
          status: 'succeeded',
          amount: 999,
        }),
        { conflictPaths: ['providerPaymentId'] },
      );
      expect(mockSubscriptionRepo.update).not.toHaveBeenCalled();
    });

    it('a null (unhandled) parsed webhook event is a no-op', async () => {
      mockStripeProvider.verifyAndParseWebhook.mockReturnValue(null);

      await service.handleWebhook('STRIPE', Buffer.from('{}'), 'sig');

      expect(mockSubscriptionRepo.update).not.toHaveBeenCalled();
      expect(mockSubscriptionRepo.upsert).not.toHaveBeenCalled();
      expect(mockPaymentRepo.upsert).not.toHaveBeenCalled();
    });
  });
});
