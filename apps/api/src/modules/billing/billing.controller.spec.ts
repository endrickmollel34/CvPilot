import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';

import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';
import { ClerkGuard } from '../auth/guards/clerk.guard';

describe('BillingController', () => {
  let controller: BillingController;

  const mockBillingService = {
    createCheckoutSession: jest.fn(),
    createPortalSession: jest.fn(),
    getSubscription: jest.fn(),
    getUsageSummary: jest.fn(),
    handleWebhook: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [BillingController],
      providers: [{ provide: BillingService, useValue: mockBillingService }],
    })
      // ClerkGuard is applied via @UseGuards() and gets instantiated during
      // module compilation even without a full HTTP pipeline — it's not
      // under test here, so it's overridden to always allow.
      .overrideGuard(ClerkGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<BillingController>(BillingController);
  });

  // ─── createCheckout() — the endpoint the fixed frontend now calls ──────────

  it('forwards the authenticated clerkId and validated plan to BillingService for Pro', async () => {
    mockBillingService.createCheckoutSession.mockResolvedValue({
      url: 'https://checkout.stripe.com/x',
    });

    const result = await controller.createCheckout({ clerkId: 'clerk-1' }, { plan: 'pro' });

    expect(mockBillingService.createCheckoutSession).toHaveBeenCalledWith('clerk-1', 'pro');
    expect(result).toEqual({ url: 'https://checkout.stripe.com/x' });
  });

  it('forwards the authenticated clerkId and validated plan to BillingService for Student', async () => {
    mockBillingService.createCheckoutSession.mockResolvedValue({
      url: 'https://checkout.stripe.com/y',
    });

    const result = await controller.createCheckout({ clerkId: 'clerk-1' }, { plan: 'student' });

    expect(mockBillingService.createCheckoutSession).toHaveBeenCalledWith('clerk-1', 'student');
    expect(result).toEqual({ url: 'https://checkout.stripe.com/y' });
  });

  it('createPortal forwards the authenticated clerkId', async () => {
    mockBillingService.createPortalSession.mockResolvedValue({
      url: 'https://billing.stripe.com/x',
    });

    await controller.createPortal({ clerkId: 'clerk-1' });

    expect(mockBillingService.createPortalSession).toHaveBeenCalledWith('clerk-1');
  });

  it('getSubscription forwards the authenticated clerkId', async () => {
    mockBillingService.getSubscription.mockResolvedValue(null);

    await controller.getSubscription({ clerkId: 'clerk-1' });

    expect(mockBillingService.getSubscription).toHaveBeenCalledWith('clerk-1');
  });

  it('getUsage forwards the authenticated clerkId and returns the usage summary', async () => {
    const summary = {
      plan: 'free',
      usage: {
        analyses: { used: 1, limit: 2, remaining: 1 },
        coverLetters: { used: 0, limit: 1, remaining: 1 },
        tailorings: { used: 0, limit: 0, remaining: 0 },
        builderCvs: { used: 1, limit: 1, remaining: 0 },
      },
    };
    mockBillingService.getUsageSummary.mockResolvedValue(summary);

    const result = await controller.getUsage({ clerkId: 'clerk-1' });

    expect(mockBillingService.getUsageSummary).toHaveBeenCalledWith('clerk-1');
    expect(result).toEqual(summary);
  });
});
