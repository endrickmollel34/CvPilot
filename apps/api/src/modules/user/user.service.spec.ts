import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { getRepositoryToken, getDataSourceToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';

import { UserService } from './user.service';
import { UserEntity } from '../../entities/user.entity';
import { ProfileEntity } from '../../entities/profile.entity';
import { CvEntity } from '../../entities/cv.entity';
import { CoverLetterEntity } from '../../entities/cover-letter.entity';
import { AnalysisEntity } from '../../entities/analysis.entity';
import { TailoringEntity } from '../../entities/tailoring.entity';
import { SubscriptionEntity } from '../../entities/subscription.entity';
import { StripePaymentProvider } from '../billing/providers/stripe.provider';

// createClerkClient is called unconditionally in UserService's constructor —
// mocked so tests never attempt a real Clerk SDK init.
jest.mock('@clerk/backend', () => ({
  createClerkClient: jest.fn().mockReturnValue({ users: { getUser: jest.fn() } }),
}));

const mockS3Send = jest.fn();
jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest
    .fn()
    .mockImplementation(() => ({ send: (...args: unknown[]) => mockS3Send(...args) })),
  DeleteObjectCommand: jest.fn().mockImplementation((input: unknown) => ({ input })),
}));

const MOCK_USER_A = { id: 'user-a-id', clerkId: 'clerk-a', email: 'a@example.com' };
const MOCK_USER_B = { id: 'user-b-id', clerkId: 'clerk-b', email: 'b@example.com' };

function makeConfig() {
  const vals: Record<string, string> = {
    CLERK_SECRET_KEY: 'sk_test_real',
    CLOUDFLARE_R2_ENDPOINT: 'https://r2.example.com',
    CLOUDFLARE_R2_ACCESS_KEY_ID: 'key',
    CLOUDFLARE_R2_SECRET_ACCESS_KEY: 'secret',
    CLOUDFLARE_R2_BUCKET_NAME: 'bucket',
  };
  return { getOrThrow: jest.fn((key: string) => vals[key]) };
}

describe('UserService — account erasure (deleteByClerkId)', () => {
  let service: UserService;

  const mockUserRepo = { findOne: jest.fn(), upsert: jest.fn(), findOneByOrFail: jest.fn() };
  const mockProfileRepo = {};
  const mockCvRepo = { find: jest.fn() };
  const mockCoverLetterRepo = { find: jest.fn() };
  const mockSubscriptionRepo = { findOneBy: jest.fn() };
  const mockStripeProvider = { cancelSubscription: jest.fn() };
  const mockManagerDelete = jest.fn();
  const mockDataSource = {
    transaction: jest.fn(
      async (cb: (manager: { delete: typeof mockManagerDelete }) => Promise<void>) => {
        await cb({ delete: mockManagerDelete });
      },
    ),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockS3Send.mockResolvedValue(undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserService,
        { provide: getRepositoryToken(UserEntity), useValue: mockUserRepo },
        { provide: getRepositoryToken(ProfileEntity), useValue: mockProfileRepo },
        { provide: getRepositoryToken(CvEntity), useValue: mockCvRepo },
        { provide: getRepositoryToken(CoverLetterEntity), useValue: mockCoverLetterRepo },
        { provide: getRepositoryToken(SubscriptionEntity), useValue: mockSubscriptionRepo },
        { provide: getDataSourceToken(), useValue: mockDataSource },
        { provide: StripePaymentProvider, useValue: mockStripeProvider },
        { provide: ConfigService, useValue: makeConfig() },
      ],
    }).compile();

    service = module.get<UserService>(UserService);

    mockUserRepo.findOne.mockResolvedValue(MOCK_USER_A);
    mockCvRepo.find.mockResolvedValue([]);
    mockCoverLetterRepo.find.mockResolvedValue([]);
    mockSubscriptionRepo.findOneBy.mockResolvedValue(null);
    mockStripeProvider.cancelSubscription.mockResolvedValue(undefined);
  });

  it('resolves the user via findByClerkId before deleting anything', async () => {
    await service.deleteByClerkId('clerk-a');

    expect(mockUserRepo.findOne).toHaveBeenCalledWith(
      expect.objectContaining({ where: { clerkId: 'clerk-a' } }),
    );
  });

  it('deletes every table scoped strictly to this user — never a bare/unscoped delete', async () => {
    await service.deleteByClerkId('clerk-a');

    expect(mockManagerDelete).toHaveBeenCalledWith(TailoringEntity, { userId: MOCK_USER_A.id });
    expect(mockManagerDelete).toHaveBeenCalledWith(CoverLetterEntity, { userId: MOCK_USER_A.id });
    expect(mockManagerDelete).toHaveBeenCalledWith(AnalysisEntity, { userId: MOCK_USER_A.id });
    expect(mockManagerDelete).toHaveBeenCalledWith(CvEntity, { userId: MOCK_USER_A.id });
    expect(mockManagerDelete).toHaveBeenCalledWith(UserEntity, { id: MOCK_USER_A.id });
    expect(mockManagerDelete).toHaveBeenCalledTimes(5);
  });

  it("never issues a delete referencing another user's id (cross-user isolation)", async () => {
    await service.deleteByClerkId('clerk-a');

    for (const call of mockManagerDelete.mock.calls) {
      const criteria = call[1] as Record<string, unknown>;
      expect(Object.values(criteria)).not.toContain(MOCK_USER_B.id);
    }
    expect(mockCvRepo.find).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: MOCK_USER_A.id } }),
    );
    expect(mockCoverLetterRepo.find).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: MOCK_USER_A.id } }),
    );
  });

  it('deletes tailorings before cover letters, analyses, and cvs — before the FK-restricted CV rows are removed', async () => {
    await service.deleteByClerkId('clerk-a');

    const order = mockManagerDelete.mock.calls.map((call) => (call[0] as { name: string }).name);
    expect(order).toEqual([
      'TailoringEntity',
      'CoverLetterEntity',
      'AnalysisEntity',
      'CvEntity',
      'UserEntity',
    ]);
  });

  it("deleting user A does not touch user B's data when user B is the resolved caller", async () => {
    mockUserRepo.findOne.mockResolvedValue(MOCK_USER_B);

    await service.deleteByClerkId('clerk-b');

    for (const call of mockManagerDelete.mock.calls) {
      const criteria = call[1] as Record<string, unknown>;
      expect(Object.values(criteria)).not.toContain(MOCK_USER_A.id);
      expect(Object.values(criteria)).toContain(MOCK_USER_B.id);
    }
  });

  it('collects R2 keys from both CVs and cover letters, including previously soft-deleted CVs', async () => {
    mockCvRepo.find.mockResolvedValue([
      { id: 'cv-1', userId: MOCK_USER_A.id, r2ObjectKey: 'cvs/user-a-id/one.pdf' },
      { id: 'cv-2', userId: MOCK_USER_A.id, r2ObjectKey: null }, // builder CV, no R2 file
    ]);
    mockCoverLetterRepo.find.mockResolvedValue([
      { id: 'cl-1', userId: MOCK_USER_A.id, r2ObjectKey: 'cover-letters/user-a-id/one.pdf' },
    ]);

    await service.deleteByClerkId('clerk-a');

    expect(mockCvRepo.find).toHaveBeenCalledWith(expect.objectContaining({ withDeleted: true }));
    expect(mockS3Send).toHaveBeenCalledTimes(2);
  });

  it('deletes R2 objects only after the DB transaction has committed', async () => {
    mockCvRepo.find.mockResolvedValue([
      { id: 'cv-1', userId: MOCK_USER_A.id, r2ObjectKey: 'cvs/user-a-id/one.pdf' },
    ]);
    const callOrder: string[] = [];
    mockDataSource.transaction.mockImplementationOnce(
      async (cb: (manager: { delete: typeof mockManagerDelete }) => Promise<void>) => {
        callOrder.push('transaction-start');
        await cb({ delete: mockManagerDelete });
        callOrder.push('transaction-committed');
      },
    );
    mockS3Send.mockImplementationOnce(async () => {
      callOrder.push('r2-delete');
    });

    await service.deleteByClerkId('clerk-a');

    expect(callOrder).toEqual(['transaction-start', 'transaction-committed', 'r2-delete']);
  });

  it('a failed R2 deletion is logged and does not throw or block other deletions', async () => {
    mockCvRepo.find.mockResolvedValue([
      { id: 'cv-1', userId: MOCK_USER_A.id, r2ObjectKey: 'cvs/user-a-id/one.pdf' },
      { id: 'cv-2', userId: MOCK_USER_A.id, r2ObjectKey: 'cvs/user-a-id/two.pdf' },
    ]);
    mockS3Send.mockRejectedValueOnce(new Error('R2 unavailable')).mockResolvedValueOnce(undefined);

    await expect(service.deleteByClerkId('clerk-a')).resolves.toBeUndefined();
    expect(mockS3Send).toHaveBeenCalledTimes(2);
  });

  it('does not attempt R2 deletion for CVs/cover letters without an object key', async () => {
    mockCvRepo.find.mockResolvedValue([
      { id: 'cv-1', userId: MOCK_USER_A.id, r2ObjectKey: undefined },
    ]);

    await service.deleteByClerkId('clerk-a');

    expect(mockS3Send).not.toHaveBeenCalled();
  });

  // ─── Stripe subscription cancellation ───────────────────────────────────────

  describe('Stripe subscription cancellation', () => {
    function subWith(overrides: Partial<{ providerSubscriptionId: string; status: string }>) {
      return {
        userId: MOCK_USER_A.id,
        providerSubscriptionId: 'sub_123',
        status: 'active',
        ...overrides,
      };
    }

    it.each(['active', 'trialing', 'past_due', 'incomplete'])(
      'cancels the subscription when status is %s',
      async (status) => {
        mockSubscriptionRepo.findOneBy.mockResolvedValue(subWith({ status }));

        await service.deleteByClerkId('clerk-a');

        expect(mockStripeProvider.cancelSubscription).toHaveBeenCalledWith('sub_123');
      },
    );

    it('cancels an active subscription that is scheduled to cancel at period end (cancelAtPeriodEnd)', async () => {
      // cancelAtPeriodEnd is a separate boolean column, not a status value —
      // the subscription is still 'active' until Stripe actually ends it,
      // so cancellation logic never needs to branch on it: this is
      // exercised the same way as the plain 'active' case above, just with
      // the flag present on the row to prove it doesn't change the outcome.
      mockSubscriptionRepo.findOneBy.mockResolvedValue({
        ...subWith({ status: 'active' }),
        cancelAtPeriodEnd: true,
      });

      await service.deleteByClerkId('clerk-a');

      expect(mockStripeProvider.cancelSubscription).toHaveBeenCalledWith('sub_123');
    });

    it('does not attempt cancellation for an already-cancelled subscription', async () => {
      mockSubscriptionRepo.findOneBy.mockResolvedValue(subWith({ status: 'cancelled' }));

      await service.deleteByClerkId('clerk-a');

      expect(mockStripeProvider.cancelSubscription).not.toHaveBeenCalled();
    });

    it('does not attempt cancellation for a Free user with no subscription row', async () => {
      mockSubscriptionRepo.findOneBy.mockResolvedValue(null);

      await service.deleteByClerkId('clerk-a');

      expect(mockStripeProvider.cancelSubscription).not.toHaveBeenCalled();
      // Erasure still proceeds normally.
      expect(mockManagerDelete).toHaveBeenCalledWith(UserEntity, { id: MOCK_USER_A.id });
    });

    it('does not attempt cancellation when a subscription row exists but has no providerSubscriptionId', async () => {
      mockSubscriptionRepo.findOneBy.mockResolvedValue(
        subWith({ providerSubscriptionId: undefined as unknown as string }),
      );

      await service.deleteByClerkId('clerk-a');

      expect(mockStripeProvider.cancelSubscription).not.toHaveBeenCalled();
    });

    it('cancels the subscription before the DB transaction starts', async () => {
      mockSubscriptionRepo.findOneBy.mockResolvedValue(subWith({}));
      const callOrder: string[] = [];
      mockStripeProvider.cancelSubscription.mockImplementationOnce(async () => {
        callOrder.push('stripe-cancelled');
      });
      mockDataSource.transaction.mockImplementationOnce(
        async (cb: (manager: { delete: typeof mockManagerDelete }) => Promise<void>) => {
          callOrder.push('transaction-start');
          await cb({ delete: mockManagerDelete });
        },
      );

      await service.deleteByClerkId('clerk-a');

      expect(callOrder).toEqual(['stripe-cancelled', 'transaction-start']);
    });

    it("looks up the subscription scoped to this user only (never another user's)", async () => {
      mockSubscriptionRepo.findOneBy.mockResolvedValue(subWith({}));

      await service.deleteByClerkId('clerk-a');

      expect(mockSubscriptionRepo.findOneBy).toHaveBeenCalledWith({ userId: MOCK_USER_A.id });
      expect(mockSubscriptionRepo.findOneBy).not.toHaveBeenCalledWith({ userId: MOCK_USER_B.id });
    });

    describe("cancellationFailure: 'abort' (self-service default)", () => {
      it('throws, and the DB transaction and R2 deletion never begin', async () => {
        mockSubscriptionRepo.findOneBy.mockResolvedValue(subWith({}));
        mockStripeProvider.cancelSubscription.mockRejectedValue(new Error('Stripe API error'));
        mockCvRepo.find.mockResolvedValue([
          { id: 'cv-1', userId: MOCK_USER_A.id, r2ObjectKey: 'cvs/user-a-id/one.pdf' },
        ]);

        await expect(service.deleteByClerkId('clerk-a', 'abort')).rejects.toThrow();

        expect(mockDataSource.transaction).not.toHaveBeenCalled();
        expect(mockManagerDelete).not.toHaveBeenCalled();
        expect(mockS3Send).not.toHaveBeenCalled();
      });

      it('defaults to abort when no behavior is specified', async () => {
        mockSubscriptionRepo.findOneBy.mockResolvedValue(subWith({}));
        mockStripeProvider.cancelSubscription.mockRejectedValue(new Error('Stripe API error'));

        await expect(service.deleteByClerkId('clerk-a')).rejects.toThrow();
        expect(mockDataSource.transaction).not.toHaveBeenCalled();
      });

      it('never exposes the underlying Stripe error to the caller', async () => {
        mockSubscriptionRepo.findOneBy.mockResolvedValue(subWith({}));
        mockStripeProvider.cancelSubscription.mockRejectedValue(
          new Error('sk_live_super_secret_detail_from_stripe'),
        );

        await expect(service.deleteByClerkId('clerk-a', 'abort')).rejects.toMatchObject({
          message: expect.not.stringContaining(
            'sk_live_super_secret_detail_from_stripe',
          ) as unknown as string,
        });
      });
    });

    describe("cancellationFailure: 'continue' (Clerk webhook)", () => {
      it('does not throw, and DB erasure and R2 cleanup both still complete', async () => {
        mockSubscriptionRepo.findOneBy.mockResolvedValue(subWith({}));
        mockStripeProvider.cancelSubscription.mockRejectedValue(new Error('Stripe API error'));
        mockCvRepo.find.mockResolvedValue([
          { id: 'cv-1', userId: MOCK_USER_A.id, r2ObjectKey: 'cvs/user-a-id/one.pdf' },
        ]);

        await expect(service.deleteByClerkId('clerk-a', 'continue')).resolves.toBeUndefined();

        expect(mockManagerDelete).toHaveBeenCalledWith(UserEntity, { id: MOCK_USER_A.id });
        expect(mockS3Send).toHaveBeenCalledWith(
          expect.objectContaining({
            input: expect.objectContaining({ Key: 'cvs/user-a-id/one.pdf' }) as unknown,
          }),
        );
      });

      it('logs an error including the provider subscription id for manual follow-up', async () => {
        const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
        mockSubscriptionRepo.findOneBy.mockResolvedValue(
          subWith({ providerSubscriptionId: 'sub_needs_manual_cancel' }),
        );
        mockStripeProvider.cancelSubscription.mockRejectedValue(new Error('Stripe API error'));

        await service.deleteByClerkId('clerk-a', 'continue');

        expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('sub_needs_manual_cancel'));
        errorSpy.mockRestore();
      });

      it('never logs secrets or raw Stripe error detail', async () => {
        const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
        mockSubscriptionRepo.findOneBy.mockResolvedValue(subWith({}));
        mockStripeProvider.cancelSubscription.mockRejectedValue(
          new Error('card number 4242 4242 4242 4242 declined'),
        );

        await service.deleteByClerkId('clerk-a', 'continue');

        const loggedText = errorSpy.mock.calls.map((call) => String(call[0])).join('\n');
        expect(loggedText).not.toContain('4242 4242 4242 4242');
        errorSpy.mockRestore();
      });
    });
  });
});
