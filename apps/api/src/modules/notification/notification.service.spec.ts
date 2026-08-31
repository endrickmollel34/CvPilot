import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';

import { NotificationService } from './notification.service';

// resend is a real HTTP client constructed directly in NotificationService's
// constructor — mocked here so tests never make network calls.
const mockSend = jest.fn();

jest.mock('resend', () => ({
  Resend: jest.fn().mockImplementation(() => ({
    emails: { send: (...args: unknown[]) => mockSend(...args) },
  })),
}));

// RESEND_API_KEY is resolved via ConfigService.get() (never getOrThrow — see
// optional-api-key.util.ts), so the mock must implement both methods:
// getOrThrow for RESEND_FROM_EMAIL, get for the optional key.
function buildService(resendKeyValue: string | undefined): NotificationService {
  const config = {
    getOrThrow: jest.fn((key: string) => {
      const vals: Record<string, string> = { RESEND_FROM_EMAIL: 'noreply@cvpilot.app' };
      return vals[key] ?? '';
    }),
    get: jest.fn((key: string) => (key === 'RESEND_API_KEY' ? resendKeyValue : undefined)),
  };
  return new NotificationService(config as unknown as ConfigService);
}

describe('NotificationService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('instantiates without throwing when RESEND_API_KEY is unset', () => {
    expect(() => buildService(undefined)).not.toThrow();
  });

  it('instantiates without throwing when RESEND_API_KEY is an obvious placeholder value', () => {
    expect(() => buildService('re_placeholder_dev_only')).not.toThrow();
  });

  it('skips sending and never calls Resend when RESEND_API_KEY is unset', async () => {
    const service = buildService(undefined);

    await expect(
      service.sendTransactional('user@example.com', 'Subject', '<p>Body</p>'),
    ).resolves.toBeUndefined();

    expect(mockSend).not.toHaveBeenCalled();
  });

  it('skips sending and never calls Resend when RESEND_API_KEY is a placeholder', async () => {
    const service = buildService('re_placeholder_dev_only');

    await expect(
      service.sendTransactional('user@example.com', 'Subject', '<p>Body</p>'),
    ).resolves.toBeUndefined();

    expect(mockSend).not.toHaveBeenCalled();
  });

  it('sends via Resend when a real key is configured', async () => {
    const service = buildService('re_real_key');
    mockSend.mockResolvedValue({ data: { id: 'email-1' }, error: null });

    await service.sendTransactional('user@example.com', 'Subject', '<p>Body</p>');

    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(mockSend).toHaveBeenCalledWith({
      from: 'noreply@cvpilot.app',
      to: 'user@example.com',
      subject: 'Subject',
      html: '<p>Body</p>',
    });
  });

  it('boots and no-ops on analysis.completed without a configured Resend key', async () => {
    const service = buildService(undefined);

    await expect(
      service.onAnalysisCompleted({ analysisId: 'analysis-1' }),
    ).resolves.toBeUndefined();

    expect(mockSend).not.toHaveBeenCalled();
  });

  it('still instantiates via Nest DI wiring with only a placeholder key present', async () => {
    const config = {
      getOrThrow: jest.fn((key: string) => {
        const vals: Record<string, string> = { RESEND_FROM_EMAIL: 'noreply@cvpilot.app' };
        return vals[key] ?? '';
      }),
      get: jest.fn((key: string) =>
        key === 'RESEND_API_KEY' ? 're_placeholder_dev_only' : undefined,
      ),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [NotificationService, { provide: ConfigService, useValue: config }],
    }).compile();

    expect(module.get<NotificationService>(NotificationService)).toBeInstanceOf(
      NotificationService,
    );
  });
});
