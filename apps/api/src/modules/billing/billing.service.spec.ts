import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { In } from 'typeorm';

import type { Plan, SubscriptionStatus } from '@cvpilot/shared';
import { BillingService } from './billing.service';
import { StripePaymentProvider } from './providers/stripe.provider';
import { SubscriptionEntity } from '../../entities/subscription.entity';
import { PaymentEntity } from '../../entities/payment.entity';
import { CvEntity } from '../../entities/cv.entity';
import { UserService } from '../user/user.service';
import { AuditService } from '../audit/audit.service';
import { USAGE_ACTIONS } from '../../common/constants/usage-actions';

const MOCK_USER = { id: 'user-1', clerkId: 'clerk-1' };

// 'student' is deliberately allowed here alongside Plan — it's no longer a
// valid Plan value, but these tests deliberately simulate a pre-existing DB
// row that still literally contains the old string (see
// resolveEffectivePlan's legacy-compatibility normalization; TypeORM never
// validates a column's raw value against the TS union it's typed as).
function mockSub(
  plan: Plan | 'student',
  status: SubscriptionStatus,
  extra: Record<string, unknown> = {},
) {
  return { userId: 'user-1', providerCustomerId: 'cus_1', plan, status, ...extra };
}

describe('BillingService', () => {
  let service: BillingService;

  const mockSubscriptionRepo = { findOneBy: jest.fn(), update: jest.fn(), upsert: jest.fn() };
  const mockPaymentRepo = { upsert: jest.fn() };
  const mockCvRepo = { count: jest.fn() };
  const mockUserService = { findByClerkId: jest.fn() };
  const mockAuditService = { countDistinctEntitiesSince: jest.fn() };
  const mockStripeProvider = {
    providerType: 'STRIPE' as const,
    createCheckoutSession: jest.fn(),
    createCustomerPortalSession: jest.fn(),
    verifyAndParseWebhook: jest.fn(),
  };

  // Quota-refund fix (see usage-actions.ts): BillingService now asks
  // AuditService.countDistinctEntitiesSince() once per resource type instead
  // of counting live rows — a single shared mock function, so tests that
  // need different simultaneous counts for analyses/coverLetters/tailorings
  // (getUsageSummary()) must key the return value off the `action` argument.
  function stubUsageCounts({
    analyses = 0,
    coverLetters = 0,
    tailorings = 0,
  }: { analyses?: number; coverLetters?: number; tailorings?: number } = {}) {
    mockAuditService.countDistinctEntitiesSince.mockImplementation((params: { action: string }) => {
      switch (params.action) {
        case USAGE_ACTIONS.ANALYSIS_GENERATED:
          return Promise.resolve(analyses);
        case USAGE_ACTIONS.COVER_LETTER_GENERATED:
          return Promise.resolve(coverLetters);
        case USAGE_ACTIONS.TAILORING_GENERATED:
          return Promise.resolve(tailorings);
        default:
          return Promise.resolve(0);
      }
    });
  }

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BillingService,
        { provide: getRepositoryToken(SubscriptionEntity), useValue: mockSubscriptionRepo },
        { provide: getRepositoryToken(PaymentEntity), useValue: mockPaymentRepo },
        { provide: getRepositoryToken(CvEntity), useValue: mockCvRepo },
        { provide: UserService, useValue: mockUserService },
        { provide: AuditService, useValue: mockAuditService },
        { provide: StripePaymentProvider, useValue: mockStripeProvider },
      ],
    }).compile();

    service = module.get<BillingService>(BillingService);

    mockUserService.findByClerkId.mockResolvedValue(MOCK_USER);
    stubUsageCounts();
  });

  // ─── createCheckoutSession() — this is the exact method the fixed frontend ──
  // now calls for the first time; it previously had zero test coverage.

  describe('createCheckoutSession()', () => {
    it('creates a checkout session for a new (never-subscribed) user without a providerCustomerId', async () => {
      mockSubscriptionRepo.findOneBy.mockResolvedValue(null);
      mockStripeProvider.createCheckoutSession.mockResolvedValue({
        url: 'https://checkout.stripe.com/session-1',
      });

      const result = await service.createCheckoutSession('clerk-1', 'pro_monthly');

      expect(mockStripeProvider.createCheckoutSession).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-1',
          providerCustomerId: undefined,
          product: 'pro_monthly',
          currency: 'GBP',
        }),
      );
      expect(result).toEqual({ url: 'https://checkout.stripe.com/session-1' });
    });

    it('creates a checkout session for Pro Annual', async () => {
      mockSubscriptionRepo.findOneBy.mockResolvedValue(null);
      mockStripeProvider.createCheckoutSession.mockResolvedValue({
        url: 'https://checkout.stripe.com/session-2',
      });

      await service.createCheckoutSession('clerk-1', 'pro_annual');

      expect(mockStripeProvider.createCheckoutSession).toHaveBeenCalledWith(
        expect.objectContaining({ product: 'pro_annual' }),
      );
    });

    it('reuses the existing Stripe customer for a previously-subscribed-but-now-cancelled user', async () => {
      // Covers "past Pro subscriber, now cancelled, clicks Start Pro again"
      // — Stripe should reuse the same customer rather than creating a
      // duplicate one. status: 'cancelled' is what makes this checkout
      // allowed at all post-fix (resolveEffectivePlan resolves 'free' for
      // it) — see the duplicate-checkout-blocking tests below for the
      // active/trialing cases that must NOT reach this far.
      mockSubscriptionRepo.findOneBy.mockResolvedValue({
        userId: 'user-1',
        providerCustomerId: 'cus_existing123',
        plan: 'pro',
        status: 'cancelled',
      });
      mockStripeProvider.createCheckoutSession.mockResolvedValue({
        url: 'https://checkout.stripe.com/session-3',
      });

      await service.createCheckoutSession('clerk-1', 'pro_monthly');

      expect(mockStripeProvider.createCheckoutSession).toHaveBeenCalledWith(
        expect.objectContaining({ providerCustomerId: 'cus_existing123' }),
      );
    });

    it('includes dashboard success/cancel URLs', async () => {
      mockSubscriptionRepo.findOneBy.mockResolvedValue(null);
      mockStripeProvider.createCheckoutSession.mockResolvedValue({
        url: 'https://checkout.stripe.com/session-4',
      });

      await service.createCheckoutSession('clerk-1', 'pro_monthly');

      expect(mockStripeProvider.createCheckoutSession).toHaveBeenCalledWith(
        expect.objectContaining({
          successUrl: expect.stringContaining('/dashboard?checkout=success'),
          cancelUrl: expect.stringContaining('/dashboard?checkout=cancelled'),
        }),
      );
    });

    it('throws BadRequestException for an unknown payment provider', async () => {
      mockSubscriptionRepo.findOneBy.mockResolvedValue(null);

      await expect(
        service.createCheckoutSession('clerk-1', 'pro_monthly', 'CLICKPESA'),
      ).rejects.toThrow(BadRequestException);
      expect(mockStripeProvider.createCheckoutSession).not.toHaveBeenCalled();
    });

    it('propagates a configuration error from the provider (e.g. placeholder Stripe env vars)', async () => {
      mockSubscriptionRepo.findOneBy.mockResolvedValue(null);
      mockStripeProvider.createCheckoutSession.mockRejectedValue(
        new Error('Payments are not configured for this environment.'),
      );

      await expect(service.createCheckoutSession('clerk-1', 'pro_monthly')).rejects.toThrow(
        'Payments are not configured for this environment.',
      );
    });
  });

  // ─── createCheckoutSession() — duplicate-subscription protection ──────────
  // See the duplicate-subscription/billing-state audit report AND its
  // follow-up review: checkout eligibility is deliberately NOT the same
  // question as entitlement. A past_due or incomplete subscription
  // correctly has Free entitlement (resolveEffectivePlan), but the
  // underlying Stripe subscription is still live and can recover on its
  // own (a retried charge succeeding, an initial payment finishing) without
  // any new Stripe object being created — so it must still block a second
  // checkout exactly like active/trialing do. Only a genuinely terminal
  // 'cancelled' status, or no subscription row at all, may proceed.
  describe('createCheckoutSession() — duplicate-subscription blocking', () => {
    it('blocks a new checkout when the user has an active subscription', async () => {
      mockSubscriptionRepo.findOneBy.mockResolvedValue(mockSub('pro', 'active'));

      await expect(service.createCheckoutSession('clerk-1', 'pro_monthly')).rejects.toThrow(
        ForbiddenException,
      );
      expect(mockStripeProvider.createCheckoutSession).not.toHaveBeenCalled();
    });

    it('blocks a new checkout when the user has a trialing subscription', async () => {
      mockSubscriptionRepo.findOneBy.mockResolvedValue(mockSub('pro', 'trialing'));

      await expect(service.createCheckoutSession('clerk-1', 'pro_annual')).rejects.toThrow(
        ForbiddenException,
      );
      expect(mockStripeProvider.createCheckoutSession).not.toHaveBeenCalled();
    });

    // The exact scenario from the audit: Stripe keeps status: 'active' for
    // the whole remaining paid period even after a cancellation is
    // scheduled — the checkout guard must respect that, not just check
    // cancelAtPeriodEnd in isolation.
    it('blocks a new checkout when the existing subscription is active with cancelAtPeriodEnd=true and the period has not ended', async () => {
      mockSubscriptionRepo.findOneBy.mockResolvedValue(
        mockSub('pro', 'active', { cancelAtPeriodEnd: true }),
      );

      await expect(service.createCheckoutSession('clerk-1', 'pro_monthly')).rejects.toThrow(
        'You already have an active subscription. Manage your existing subscription from Billing.',
      );
      expect(mockStripeProvider.createCheckoutSession).not.toHaveBeenCalled();
    });

    it('blocks a new checkout for a legacy Student subscription that is still active — it already resolves to Pro entitlement', async () => {
      mockSubscriptionRepo.findOneBy.mockResolvedValue(mockSub('student', 'active'));

      await expect(service.createCheckoutSession('clerk-1', 'pro_annual')).rejects.toThrow(
        ForbiddenException,
      );
      expect(mockStripeProvider.createCheckoutSession).not.toHaveBeenCalled();
    });

    // ─── The exact concern from the follow-up review ───────────────────────
    // resolveEffectivePlan(sub) !== 'free' was the ORIGINAL (too permissive)
    // guard — it allows past_due/incomplete through because their
    // *entitlement* is Free, even though the *Stripe subscription itself*
    // is still live and non-terminal. hasNonTerminalSubscription() is the
    // dedicated checkout-eligibility check that correctly blocks these.

    it('blocks a new checkout when the existing subscription is past_due — it is still a live, potentially-recoverable Stripe subscription, not a terminal one', async () => {
      mockSubscriptionRepo.findOneBy.mockResolvedValue(mockSub('pro', 'past_due'));

      await expect(service.createCheckoutSession('clerk-1', 'pro_monthly')).rejects.toThrow(
        ForbiddenException,
      );
      expect(mockStripeProvider.createCheckoutSession).not.toHaveBeenCalled();
    });

    it('blocks a new checkout when the existing subscription is incomplete — still non-terminal, not yet a settled outcome', async () => {
      mockSubscriptionRepo.findOneBy.mockResolvedValue(mockSub('pro', 'incomplete'));

      await expect(service.createCheckoutSession('clerk-1', 'pro_annual')).rejects.toThrow(
        ForbiddenException,
      );
      expect(mockStripeProvider.createCheckoutSession).not.toHaveBeenCalled();
    });

    it('allows checkout for a cancelled subscriber — the only genuinely terminal status', async () => {
      mockSubscriptionRepo.findOneBy.mockResolvedValue(mockSub('pro', 'cancelled'));
      mockStripeProvider.createCheckoutSession.mockResolvedValue({
        url: 'https://checkout.stripe.com/session-new',
      });

      await expect(service.createCheckoutSession('clerk-1', 'pro_monthly')).resolves.toEqual({
        url: 'https://checkout.stripe.com/session-new',
      });
      expect(mockStripeProvider.createCheckoutSession).toHaveBeenCalled();
    });

    it('allows checkout for a genuinely free user with no subscription row at all', async () => {
      mockSubscriptionRepo.findOneBy.mockResolvedValue(null);
      mockStripeProvider.createCheckoutSession.mockResolvedValue({
        url: 'https://checkout.stripe.com/session-new-3',
      });

      await expect(service.createCheckoutSession('clerk-1', 'pro_monthly')).resolves.toEqual({
        url: 'https://checkout.stripe.com/session-new-3',
      });
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

    // Legacy compatibility — Student was removed as a Plan value, but a
    // pre-existing DB row can still literally contain the old 'student'
    // string (no data migration rewrites it). This must normalize to the
    // 'pro' entitlement, never fall through to 'free'.
    it("normalizes a legacy plan='student' row to the 'pro' entitlement", async () => {
      mockSubscriptionRepo.findOneBy.mockResolvedValue(mockSub('student', 'active'));
      await expect(service.getUserPlan('user-1')).resolves.toBe('pro');
    });

    it('retains paid access for a trialing Pro subscription', async () => {
      mockSubscriptionRepo.findOneBy.mockResolvedValue(mockSub('pro', 'trialing'));
      await expect(service.getUserPlan('user-1')).resolves.toBe('pro');
    });

    it("retains paid access for a trialing legacy plan='student' subscription, normalized to 'pro'", async () => {
      mockSubscriptionRepo.findOneBy.mockResolvedValue(mockSub('student', 'trialing'));
      await expect(service.getUserPlan('user-1')).resolves.toBe('pro');
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
      stubUsageCounts({ analyses: 999 });

      await expect(service.canPerformAction('user-1', 'analyse')).resolves.toBe(true);
    });

    it('allows unlimited cover letters for an active Student subscription regardless of usage', async () => {
      mockSubscriptionRepo.findOneBy.mockResolvedValue(mockSub('student', 'active'));
      stubUsageCounts({ coverLetters: 999 });

      await expect(service.canPerformAction('user-1', 'cover-letter')).resolves.toBe(true);
    });

    it('allows unlimited analyses for a trialing Pro subscription', async () => {
      mockSubscriptionRepo.findOneBy.mockResolvedValue(mockSub('pro', 'trialing'));
      stubUsageCounts({ analyses: 999 });

      await expect(service.canPerformAction('user-1', 'analyse')).resolves.toBe(true);
    });

    it('enforces the Free analysesPerMonth limit on a past_due Pro subscription — the core bug this fix closes', async () => {
      mockSubscriptionRepo.findOneBy.mockResolvedValue(mockSub('pro', 'past_due'));
      stubUsageCounts({ analyses: 2 }); // Free limit is 2

      await expect(service.canPerformAction('user-1', 'analyse')).resolves.toBe(false);
    });

    it('enforces the Free coverLettersPerMonth limit on an incomplete Student subscription', async () => {
      mockSubscriptionRepo.findOneBy.mockResolvedValue(mockSub('student', 'incomplete'));
      stubUsageCounts({ coverLetters: 1 }); // Free limit is 1

      await expect(service.canPerformAction('user-1', 'cover-letter')).resolves.toBe(false);
    });

    it('allows a Free-plan user under the analysesPerMonth boundary', async () => {
      mockSubscriptionRepo.findOneBy.mockResolvedValue(null);
      stubUsageCounts({ analyses: 1 }); // below the limit of 2

      await expect(service.canPerformAction('user-1', 'analyse')).resolves.toBe(true);
    });

    it('blocks a Free-plan user exactly at the analysesPerMonth boundary', async () => {
      mockSubscriptionRepo.findOneBy.mockResolvedValue(null);
      stubUsageCounts({ analyses: 2 }); // at the limit of 2

      await expect(service.canPerformAction('user-1', 'analyse')).resolves.toBe(false);
    });

    it('allows a Free-plan user under the coverLettersPerMonth boundary', async () => {
      mockSubscriptionRepo.findOneBy.mockResolvedValue(null);
      stubUsageCounts({ coverLetters: 0 }); // below the limit of 1

      await expect(service.canPerformAction('user-1', 'cover-letter')).resolves.toBe(true);
    });

    it('blocks a Free-plan user exactly at the coverLettersPerMonth boundary', async () => {
      mockSubscriptionRepo.findOneBy.mockResolvedValue(null);
      stubUsageCounts({ coverLetters: 1 }); // at the limit of 1

      await expect(service.canPerformAction('user-1', 'cover-letter')).resolves.toBe(false);
    });

    // ─── Delegates the correct action/scope to AuditService ───────────────────

    it('asks AuditService for the ANALYSIS_GENERATED action, scoped to this user, since the start of the month', async () => {
      mockSubscriptionRepo.findOneBy.mockResolvedValue(null); // Free plan
      stubUsageCounts({ analyses: 0 });

      await service.canPerformAction('user-1', 'analyse');

      expect(mockAuditService.countDistinctEntitiesSince).toHaveBeenCalledWith({
        userId: 'user-1',
        action: USAGE_ACTIONS.ANALYSIS_GENERATED,
        since: expect.any(Date) as unknown as Date,
      });
    });

    it('asks AuditService for the COVER_LETTER_GENERATED action, scoped to this user, since the start of the month', async () => {
      mockSubscriptionRepo.findOneBy.mockResolvedValue(null); // Free plan
      stubUsageCounts({ coverLetters: 0 });

      await service.canPerformAction('user-1', 'cover-letter');

      expect(mockAuditService.countDistinctEntitiesSince).toHaveBeenCalledWith({
        userId: 'user-1',
        action: USAGE_ACTIONS.COVER_LETTER_GENERATED,
        since: expect.any(Date) as unknown as Date,
      });
    });

    // ─── Failed AI generations must not consume quota ────────────────────────
    // Previously enforced by a live status: Not('failed') filter on the
    // analyses/cover_letters row count — see the quota-refund fix in
    // usage-actions.ts / AnalysisService.process() / CoverLetterService
    // .process(): AuditService.log() is only ever called on the genuine
    // success path, so a failed generation simply never produces a
    // countable audit_logs record in the first place. There is no longer a
    // live `status` field for BillingService's query to filter — the
    // guarantee has moved to the write side, tested in each generating
    // service's own spec (see "never logs a usage record when ... fails").

    it('allows a Free user whose only prior attempt this month failed (no usage record was ever logged for it)', async () => {
      mockSubscriptionRepo.findOneBy.mockResolvedValue(null);
      stubUsageCounts({ analyses: 0 });

      await expect(service.canPerformAction('user-1', 'analyse')).resolves.toBe(true);
    });

    it('blocks a Free user once successfully-logged analyses reach the limit, regardless of additional failed attempts', async () => {
      // Models: 2 successful (logged) analyses plus several failed
      // (never-logged) ones this month — the durable count correctly
      // reports 2, hitting the Free limit of 2.
      mockSubscriptionRepo.findOneBy.mockResolvedValue(null);
      stubUsageCounts({ analyses: 2 });

      await expect(service.canPerformAction('user-1', 'analyse')).resolves.toBe(false);
    });

    it('blocks a Free user once successfully-logged cover letters reach the limit, regardless of additional failed attempts', async () => {
      mockSubscriptionRepo.findOneBy.mockResolvedValue(null);
      stubUsageCounts({ coverLetters: 1 });

      await expect(service.canPerformAction('user-1', 'cover-letter')).resolves.toBe(false);
    });

    // ─── Quota-refund fix — deletion cannot restore already-consumed usage ────
    // This is the property BillingService itself is responsible for:
    // whatever AuditService reports is trusted as-is, with no live-row
    // recomputation that a deletion could have changed.

    it('trusts the durable AuditService count as-is — nothing here recomputes usage from live content rows', async () => {
      mockSubscriptionRepo.findOneBy.mockResolvedValue(null); // Free plan, limit 2
      // Models the exact refund scenario: 2 analyses were generated and
      // logged this month; one was since hard-deleted. The durable count
      // still correctly reports 2 (audit_logs rows are never deleted), so
      // the Free limit is still (correctly) enforced.
      stubUsageCounts({ analyses: 2 });

      await expect(service.canPerformAction('user-1', 'analyse')).resolves.toBe(false);
    });
  });

  // ─── getUsageSummary() — usage visibility (never gated by dev bypass) ──────

  describe('getUsageSummary()', () => {
    beforeEach(() => {
      stubUsageCounts();
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
      stubUsageCounts({ analyses: 1, coverLetters: 0 });
      mockCvRepo.count.mockResolvedValue(1);

      const result = await service.getUsageSummary('clerk-1');

      expect(result.usage.analyses).toEqual({ used: 1, limit: 2, remaining: 1 });
      expect(result.usage.coverLetters).toEqual({ used: 0, limit: 1, remaining: 1 });
      expect(result.usage.builderCvs).toEqual({ used: 1, limit: 1, remaining: 0 });
    });

    it('reports remaining: 0 (not negative) once a Free limit is exhausted', async () => {
      mockSubscriptionRepo.findOneBy.mockResolvedValue(null);
      stubUsageCounts({ analyses: 2, coverLetters: 1 });

      const result = await service.getUsageSummary('clerk-1');

      expect(result.usage.analyses).toEqual({ used: 2, limit: 2, remaining: 0 });
      expect(result.usage.coverLetters).toEqual({ used: 1, limit: 1, remaining: 0 });
    });

    // Previously: asserted a live status: Not('failed') filter on each
    // repo's count() query. Quota-refund fix (see usage-actions.ts): failed
    // generations are now excluded by construction — AnalysisService/
    // CoverLetterService/TailoringService only ever call AuditService.log()
    // on their genuine success path, so a failed generation simply never
    // produces a countable audit_logs record. This asserts the *new*
    // mechanism: BillingService asks for exactly the three *_GENERATED
    // actions, scoped to this user and the current month.
    it('asks AuditService for exactly the three *_GENERATED actions, scoped to this user and this month', async () => {
      mockSubscriptionRepo.findOneBy.mockResolvedValue(null);

      await service.getUsageSummary('clerk-1');

      for (const action of [
        USAGE_ACTIONS.ANALYSIS_GENERATED,
        USAGE_ACTIONS.COVER_LETTER_GENERATED,
        USAGE_ACTIONS.TAILORING_GENERATED,
      ]) {
        expect(mockAuditService.countDistinctEntitiesSince).toHaveBeenCalledWith({
          userId: 'user-1',
          action,
          since: expect.any(Date) as unknown as Date,
        });
      }
    });

    it('reports unlimited (null limit/remaining) usage for an active Pro subscription', async () => {
      mockSubscriptionRepo.findOneBy.mockResolvedValue(mockSub('pro', 'active'));
      stubUsageCounts({ analyses: 50 });

      const result = await service.getUsageSummary('clerk-1');

      expect(result.plan).toBe('pro');
      expect(result.rawPlan).toBe('pro');
      expect(result.subscriptionStatus).toBe('active');
      expect(result.usage.analyses).toEqual({ used: 50, limit: null, remaining: null });
      expect(result.usage.coverLetters).toEqual({ used: 0, limit: null, remaining: null });
      expect(result.usage.tailorings).toEqual({ used: 0, limit: null, remaining: null });
      expect(result.usage.builderCvs).toEqual({ used: 0, limit: null, remaining: null });
    });

    it("reports unlimited (null limit/remaining) usage for a legacy plan='student' subscription, normalized to 'pro'", async () => {
      mockSubscriptionRepo.findOneBy.mockResolvedValue(mockSub('student', 'active'));

      const result = await service.getUsageSummary('clerk-1');

      expect(result.plan).toBe('pro');
      expect(result.usage.analyses.limit).toBeNull();
      expect(result.usage.tailorings.limit).toBeNull();
    });

    it('reports effective Free limits for a past_due Pro subscription record', async () => {
      mockSubscriptionRepo.findOneBy.mockResolvedValue(mockSub('pro', 'past_due'));
      stubUsageCounts({ analyses: 2 });

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
        stubUsageCounts({ analyses: 2 }); // at the Free limit

        const result = await service.getUsageSummary('clerk-1');

        // Real, exhausted usage is reported even though canPerformAction()
        // would bypass enforcement in this same environment.
        expect(result.usage.analyses).toEqual({ used: 2, limit: 2, remaining: 0 });
      } finally {
        process.env['NODE_ENV'] = original;
      }
    });

    // ─── Quota-refund fix — deletion cannot restore already-consumed usage ────

    it('still reports the earlier-consumed usage after the content row that earned it was hard-deleted', async () => {
      // Models the exact refund scenario: 2 analyses were generated and
      // logged this month; both were since hard-deleted (e.g. via
      // DELETE /analyses/:id). The durable audit_logs count is unaffected
      // by that deletion — usage still correctly reports 2, not 0.
      mockSubscriptionRepo.findOneBy.mockResolvedValue(null);
      stubUsageCounts({ analyses: 2 });

      const result = await service.getUsageSummary('clerk-1');

      expect(result.usage.analyses).toEqual({ used: 2, limit: 2, remaining: 0 });
    });
  });

  // ─── handleWebhook() — subscription state transitions ──────────────────────
  // These were previously untested: BillingService's event-application logic
  // (applyBillingEvent → onSubscription*/onPayment*) had zero direct
  // coverage before this fix.

  describe('handleWebhook() — subscription state transitions', () => {
    async function fireEvent(event: Record<string, unknown>) {
      mockStripeProvider.verifyAndParseWebhook.mockResolvedValue(event);
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

    // No schema change — billingProduct is stashed in the existing,
    // previously-unused providerMetadata jsonb column so the dashboard can
    // distinguish Monthly vs Annual Pro without Plan itself knowing about
    // billing cadence.
    it('subscription.activated persists billingProduct into providerMetadata when the event carries one', async () => {
      await fireEvent({
        type: 'subscription.activated',
        provider: 'STRIPE',
        providerCustomerId: 'cus_1',
        providerSubscriptionId: 'sub_1',
        plan: 'pro',
        billingProduct: 'pro_monthly',
        subscriptionStatus: 'trialing',
        paymentMethod: 'CARD',
        metadata: { internalUserId: 'user-1' },
      });

      expect(mockSubscriptionRepo.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          providerMetadata: { billingProduct: 'pro_monthly' },
        }),
        { conflictPaths: ['userId'] },
      );
    });

    // ─── Activation period-date fix (duplicate-subscription audit) ─────────
    // onSubscriptionActivated previously never wrote currentPeriodStart/End
    // at all — a brand-new checkout's row kept showing whatever period end
    // was already there (e.g. an old Student subscription's Oct 1) until
    // some later subscription.updated event happened to correct it. The
    // fix persists these fields unconditionally on every activation.

    it('onSubscriptionActivated persists currentPeriodStart/currentPeriodEnd from the activation event', async () => {
      await fireEvent({
        type: 'subscription.activated',
        provider: 'STRIPE',
        providerCustomerId: 'cus_1',
        providerSubscriptionId: 'sub_new_pro',
        plan: 'pro',
        billingProduct: 'pro_monthly',
        subscriptionStatus: 'trialing',
        paymentMethod: 'CARD',
        currentPeriodStart: new Date('2026-09-12T00:00:00.000Z'),
        currentPeriodEnd: new Date('2026-09-19T00:00:00.000Z'),
        metadata: { internalUserId: 'user-1' },
      });

      expect(mockSubscriptionRepo.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          providerSubscriptionId: 'sub_new_pro',
          currentPeriodStart: new Date('2026-09-12T00:00:00.000Z'),
          currentPeriodEnd: new Date('2026-09-19T00:00:00.000Z'),
        }),
        { conflictPaths: ['userId'] },
      );
    });

    // The row is a single upsert keyed by userId — this proves the new
    // subscription's dates are what actually get written, regardless of
    // what an older subscription's dates might have been (e.g. Oct 1 from
    // a legacy Student subscription) — there is no merge with the previous
    // row's values, only a full replacement of these fields every time.
    it('activation writes the new subscription’s period dates rather than merging with/preserving any prior value', async () => {
      await fireEvent({
        type: 'subscription.activated',
        provider: 'STRIPE',
        providerCustomerId: 'cus_1',
        providerSubscriptionId: 'sub_new_pro',
        plan: 'pro',
        subscriptionStatus: 'trialing',
        currentPeriodStart: new Date('2026-09-12T00:00:00.000Z'),
        currentPeriodEnd: new Date('2026-09-19T00:00:00.000Z'), // NOT Oct 1
        metadata: { internalUserId: 'user-1' },
      });

      const upsertPayload = mockSubscriptionRepo.upsert.mock.calls[0]?.[0] as Record<
        string,
        unknown
      >;
      expect(upsertPayload['currentPeriodEnd']).toEqual(new Date('2026-09-19T00:00:00.000Z'));
      expect(upsertPayload['currentPeriodEnd']).not.toEqual(new Date('2026-10-01T00:00:00.000Z'));
    });

    it('onSubscriptionActivated writes explicit null period dates when the activation event genuinely has none, rather than silently omitting the columns', async () => {
      await fireEvent({
        type: 'subscription.activated',
        provider: 'STRIPE',
        providerCustomerId: 'cus_1',
        providerSubscriptionId: 'sub_new_pro',
        plan: 'pro',
        subscriptionStatus: 'active',
        metadata: { internalUserId: 'user-1' },
      });

      const upsertPayload = mockSubscriptionRepo.upsert.mock.calls[0]?.[0] as Record<
        string,
        unknown
      >;
      expect(upsertPayload).toHaveProperty('currentPeriodStart', null);
      expect(upsertPayload).toHaveProperty('currentPeriodEnd', null);
    });

    it('subscription.updated persists billingProduct into providerMetadata when the event carries one', async () => {
      await fireEvent({
        type: 'subscription.updated',
        provider: 'STRIPE',
        providerCustomerId: 'cus_1',
        providerSubscriptionId: 'sub_1',
        plan: 'pro',
        billingProduct: 'pro_annual',
        subscriptionStatus: 'active',
      });

      expect(mockSubscriptionRepo.update).toHaveBeenCalledWith(
        { providerCustomerId: 'cus_1', providerSubscriptionId: 'sub_1' },
        expect.objectContaining({ providerMetadata: { billingProduct: 'pro_annual' } }),
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
        providerSubscriptionId: 'sub_1',
        plan: 'pro',
        subscriptionStatus: 'active',
        currentPeriodStart: new Date('2026-01-01'),
        currentPeriodEnd: new Date('2026-02-01'),
        cancelAtPeriodEnd: false,
      });

      expect(mockSubscriptionRepo.update).toHaveBeenCalledWith(
        { providerCustomerId: 'cus_1', providerSubscriptionId: 'sub_1' },
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
        providerSubscriptionId: 'sub_1',
        cancelAtPeriodEnd: true,
      });

      expect(mockSubscriptionRepo.update).toHaveBeenCalledWith(
        { providerCustomerId: 'cus_1', providerSubscriptionId: 'sub_1' },
        { cancelAtPeriodEnd: true },
      );
    });

    // ─── current matching events still apply normally ──────────────────────

    it('current matching subscription.updated still works — restoring status to active reinstates paid entitlements (recovery from past_due)', async () => {
      await fireEvent({
        type: 'subscription.updated',
        provider: 'STRIPE',
        providerCustomerId: 'cus_1',
        providerSubscriptionId: 'sub_current',
        subscriptionStatus: 'active',
      });

      expect(mockSubscriptionRepo.update).toHaveBeenCalledWith(
        { providerCustomerId: 'cus_1', providerSubscriptionId: 'sub_current' },
        { status: 'active' },
      );

      // And the entitlement layer correctly reflects the restored row.
      mockSubscriptionRepo.findOneBy.mockResolvedValue(mockSub('pro', 'active'));
      await expect(service.getUserPlan('user-1')).resolves.toBe('pro');
    });

    it('current matching cancellation still works — subscription.cancelled resets status to cancelled and plan to free', async () => {
      await fireEvent({
        type: 'subscription.cancelled',
        provider: 'STRIPE',
        providerCustomerId: 'cus_1',
        providerSubscriptionId: 'sub_current',
        subscriptionStatus: 'cancelled',
      });

      expect(mockSubscriptionRepo.update).toHaveBeenCalledWith(
        { providerCustomerId: 'cus_1', providerSubscriptionId: 'sub_current' },
        { status: 'cancelled', plan: 'free', cancelAtPeriodEnd: false },
      );
    });

    it('current matching payment.failed still works — sets status to past_due without touching plan', async () => {
      await fireEvent({
        type: 'payment.failed',
        provider: 'STRIPE',
        providerCustomerId: 'cus_1',
        providerSubscriptionId: 'sub_current',
        paymentStatus: 'failed',
      });

      expect(mockSubscriptionRepo.update).toHaveBeenCalledWith(
        { providerCustomerId: 'cus_1', providerSubscriptionId: 'sub_current' },
        { status: 'past_due' },
      );
    });

    // ─── Stale/older-subscription webhook protection (duplicate-subscription audit) ─
    // Every mutation below is scoped to BOTH providerCustomerId AND
    // providerSubscriptionId, never providerCustomerId alone — so an event
    // about a subscription that is no longer the one on file for this
    // customer (e.g. a legacy Student subscription's own webhooks, arriving
    // after a newer Pro subscription has taken over the row) can only ever
    // match zero rows in the real database, never the current row. These
    // tests prove the call is always narrowly scoped, which is exactly the
    // mechanism that makes a stale event's WHERE clause harmless — a plain
    // customerId-only match (asserted absent below) is what would have let
    // it silently overwrite the current row instead.

    it('scopes subscription.updated by both providerCustomerId and providerSubscriptionId — never providerCustomerId alone', async () => {
      await fireEvent({
        type: 'subscription.updated',
        provider: 'STRIPE',
        providerCustomerId: 'cus_1',
        providerSubscriptionId: 'sub_old_student',
        subscriptionStatus: 'active',
        currentPeriodEnd: new Date('2026-10-01'),
      });

      expect(mockSubscriptionRepo.update).toHaveBeenCalledWith(
        { providerCustomerId: 'cus_1', providerSubscriptionId: 'sub_old_student' },
        expect.anything(),
      );
      expect(mockSubscriptionRepo.update).not.toHaveBeenCalledWith(
        { providerCustomerId: 'cus_1' },
        expect.anything(),
      );
    });

    it('does not mutate the subscription row when subscription.updated is missing providerSubscriptionId — fails safe rather than a providerCustomerId-only update', async () => {
      await fireEvent({
        type: 'subscription.updated',
        provider: 'STRIPE',
        providerCustomerId: 'cus_1',
        subscriptionStatus: 'active',
      });

      expect(mockSubscriptionRepo.update).not.toHaveBeenCalled();
    });

    it('scopes subscription.cancelled by both providerCustomerId and providerSubscriptionId — never providerCustomerId alone', async () => {
      await fireEvent({
        type: 'subscription.cancelled',
        provider: 'STRIPE',
        providerCustomerId: 'cus_1',
        providerSubscriptionId: 'sub_old_student',
        subscriptionStatus: 'cancelled',
      });

      expect(mockSubscriptionRepo.update).toHaveBeenCalledWith(
        { providerCustomerId: 'cus_1', providerSubscriptionId: 'sub_old_student' },
        expect.anything(),
      );
      expect(mockSubscriptionRepo.update).not.toHaveBeenCalledWith(
        { providerCustomerId: 'cus_1' },
        expect.anything(),
      );
    });

    it('does not mutate the subscription row when subscription.cancelled is missing providerSubscriptionId — fails safe rather than a providerCustomerId-only update', async () => {
      await fireEvent({
        type: 'subscription.cancelled',
        provider: 'STRIPE',
        providerCustomerId: 'cus_1',
        subscriptionStatus: 'cancelled',
      });

      expect(mockSubscriptionRepo.update).not.toHaveBeenCalled();
    });

    it('scopes payment.failed by both providerCustomerId and providerSubscriptionId — never providerCustomerId alone', async () => {
      await fireEvent({
        type: 'payment.failed',
        provider: 'STRIPE',
        providerCustomerId: 'cus_1',
        providerSubscriptionId: 'sub_old_student',
        paymentStatus: 'failed',
      });

      expect(mockSubscriptionRepo.update).toHaveBeenCalledWith(
        { providerCustomerId: 'cus_1', providerSubscriptionId: 'sub_old_student' },
        expect.anything(),
      );
      expect(mockSubscriptionRepo.update).not.toHaveBeenCalledWith(
        { providerCustomerId: 'cus_1' },
        expect.anything(),
      );
    });

    it('does not mutate the subscription row when payment.failed is missing providerSubscriptionId (e.g. a non-subscription invoice) — fails safe rather than a providerCustomerId-only update', async () => {
      await fireEvent({
        type: 'payment.failed',
        provider: 'STRIPE',
        providerCustomerId: 'cus_1',
        paymentStatus: 'failed',
      });

      expect(mockSubscriptionRepo.update).not.toHaveBeenCalled();
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

    // Regression test: a Clerk-triggered account erasure can hard-delete the
    // user (and cascade-delete their subscription) in the narrow window
    // between this handler's findOneBy and its upsert, since they run on
    // independent DB connections. The resulting FK violation on
    // payments.user_id must not crash the Stripe webhook request — there is
    // nothing left to record the payment against, and Stripe retrying
    // forever would never succeed.
    it('swallows a payment upsert failure caused by the account being deleted concurrently, rather than throwing', async () => {
      mockSubscriptionRepo.findOneBy.mockResolvedValue(mockSub('pro', 'active'));
      mockPaymentRepo.upsert.mockRejectedValueOnce(
        Object.assign(
          new Error('insert or update on table "payments" violates foreign key constraint'),
          {
            name: 'QueryFailedError',
          },
        ),
      );

      await expect(
        fireEvent({
          type: 'payment.succeeded',
          provider: 'STRIPE',
          providerCustomerId: 'cus_1',
          providerPaymentId: 'pi_1',
          paymentStatus: 'succeeded',
          paymentMethod: 'CARD',
          amountMinorUnits: 999,
          currency: 'GBP',
        }),
      ).resolves.toBeUndefined();
    });

    it('a null (unhandled) parsed webhook event is a no-op', async () => {
      mockStripeProvider.verifyAndParseWebhook.mockResolvedValue(null);

      await service.handleWebhook('STRIPE', Buffer.from('{}'), 'sig');

      expect(mockSubscriptionRepo.update).not.toHaveBeenCalled();
      expect(mockSubscriptionRepo.upsert).not.toHaveBeenCalled();
      expect(mockPaymentRepo.upsert).not.toHaveBeenCalled();
    });
  });
});
