import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException } from '@nestjs/common';

import { BillingService } from './billing.service';
import { StripePaymentProvider } from './providers/stripe.provider';
import { SubscriptionEntity } from '../../entities/subscription.entity';
import { PaymentEntity } from '../../entities/payment.entity';
import { AnalysisEntity } from '../../entities/analysis.entity';
import { CoverLetterEntity } from '../../entities/cover-letter.entity';
import { UserService } from '../user/user.service';

const MOCK_USER = { id: 'user-1', clerkId: 'clerk-1' };

describe('BillingService', () => {
  let service: BillingService;

  const mockSubscriptionRepo = { findOneBy: jest.fn(), update: jest.fn(), upsert: jest.fn() };
  const mockPaymentRepo = { upsert: jest.fn() };
  const mockAnalysisRepo = { count: jest.fn() };
  const mockCoverLetterRepo = { count: jest.fn() };
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
});
