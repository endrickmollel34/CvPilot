import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { NotFoundException } from '@nestjs/common';

import { AuthService } from './auth.service';
import { UserService } from '../user/user.service';

const mockVerify = jest.fn();
jest.mock('svix', () => ({
  Webhook: jest
    .fn()
    .mockImplementation(() => ({ verify: (...args: unknown[]) => mockVerify(...args) })),
}));

function makeConfig() {
  return { getOrThrow: jest.fn().mockReturnValue('whsec_test') };
}

describe('AuthService — Clerk user.deleted webhook', () => {
  let service: AuthService;

  const mockUserService = { findOrCreateByClerkId: jest.fn(), deleteByClerkId: jest.fn() };

  const headers = { svixId: 'id', svixTimestamp: 'ts', svixSignature: 'sig' };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: ConfigService, useValue: makeConfig() },
        { provide: UserService, useValue: mockUserService },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  it("deletes the local account using the 'continue' cancellation-failure behavior, not 'abort'", async () => {
    mockVerify.mockReturnValue({
      type: 'user.deleted',
      data: { id: 'clerk-deleted-1', email_addresses: [], primary_email_address_id: '' },
    });
    mockUserService.deleteByClerkId.mockResolvedValue(undefined);

    await service.handleClerkWebhook(headers, Buffer.from('{}'));

    expect(mockUserService.deleteByClerkId).toHaveBeenCalledWith('clerk-deleted-1', 'continue');
  });

  it('swallows a genuine "no local record" NotFoundException without throwing (user deleted before first sync, or an earlier retry already erased it)', async () => {
    mockVerify.mockReturnValue({
      type: 'user.deleted',
      data: { id: 'clerk-never-synced', email_addresses: [], primary_email_address_id: '' },
    });
    mockUserService.deleteByClerkId.mockRejectedValue(new NotFoundException('User not found'));

    await expect(service.handleClerkWebhook(headers, Buffer.from('{}'))).resolves.toEqual({
      received: true,
    });
  });

  // Regression test for the production bug: Clerk successfully delivered
  // user.deleted, Stripe cancellation ran, but the user row was never
  // erased — because this handler used to catch *any* error (not just a
  // genuine "no local record") and always report success. A real erasure
  // failure (e.g. the DB transaction in UserService.deleteByClerkId
  // throwing) was silently discarded, Clerk was told 200 and never
  // retried, and the row was permanently stuck with no error trail.
  it('does NOT swallow a real erasure failure — it must propagate so the controller returns non-2xx and Clerk retries', async () => {
    mockVerify.mockReturnValue({
      type: 'user.deleted',
      data: { id: 'clerk-deleted-3', email_addresses: [], primary_email_address_id: '' },
    });
    mockUserService.deleteByClerkId.mockRejectedValue(new Error('deadlock detected'));

    await expect(service.handleClerkWebhook(headers, Buffer.from('{}'))).rejects.toThrow(
      'deadlock detected',
    );
  });

  it('does not swallow the webhook response even when deleteByClerkId erased data despite a Stripe failure', async () => {
    // deleteByClerkId('continue') never throws for a Stripe-cancellation
    // failure (it's absorbed internally — see UserService) — this just
    // confirms the webhook still reports success in that case.
    mockVerify.mockReturnValue({
      type: 'user.deleted',
      data: { id: 'clerk-deleted-2', email_addresses: [], primary_email_address_id: '' },
    });
    mockUserService.deleteByClerkId.mockResolvedValue(undefined);

    const result = await service.handleClerkWebhook(headers, Buffer.from('{}'));

    expect(result).toEqual({ received: true });
  });
});
