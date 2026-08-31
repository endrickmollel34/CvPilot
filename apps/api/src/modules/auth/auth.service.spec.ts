import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';

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

  it('swallows a "no local record" failure without throwing (user deleted before first sync)', async () => {
    mockVerify.mockReturnValue({
      type: 'user.deleted',
      data: { id: 'clerk-never-synced', email_addresses: [], primary_email_address_id: '' },
    });
    mockUserService.deleteByClerkId.mockRejectedValue(new Error('User not found'));

    await expect(service.handleClerkWebhook(headers, Buffer.from('{}'))).resolves.toEqual({
      received: true,
    });
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
