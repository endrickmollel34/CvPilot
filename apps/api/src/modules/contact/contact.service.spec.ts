import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { Logger, ServiceUnavailableException } from '@nestjs/common';

import { ContactService } from './contact.service';
import { NotificationService } from '../notification/notification.service';
import type { SubmitContactDto } from './dto/submit-contact.dto';

function dto(overrides: Partial<SubmitContactDto> = {}): SubmitContactDto {
  return {
    name: 'Jane Doe',
    email: 'jane@example.com',
    category: 'general',
    message: 'Hello, I have a question about CVPilot.',
    ...overrides,
  } as SubmitContactDto;
}

describe('ContactService', () => {
  let service: ContactService;

  const mockNotificationService = { sendTransactional: jest.fn() };
  const mockConfig = { get: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockConfig.get.mockReturnValue('owner@real-inbox.example');
    mockNotificationService.sendTransactional.mockResolvedValue(undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContactService,
        { provide: NotificationService, useValue: mockNotificationService },
        { provide: ConfigService, useValue: mockConfig },
      ],
    }).compile();

    service = module.get<ContactService>(ContactService);
  });

  it('sends the email to the server-configured recipient, using the visitor email as Reply-To — never as the recipient or from address', async () => {
    await service.submit(dto({ email: 'visitor@example.com' }));

    expect(mockNotificationService.sendTransactional).toHaveBeenCalledTimes(1);
    const [to, , , replyTo] = mockNotificationService.sendTransactional.mock.calls[0] as [
      string,
      string,
      string,
      string,
    ];
    expect(to).toBe('owner@real-inbox.example');
    expect(replyTo).toBe('visitor@example.com');
  });

  it('includes name, category, and message in the email body, and never anywhere as the from/to address', async () => {
    await service.submit(
      dto({ name: 'Alex Visitor', category: 'billing', message: 'Question about my invoice.' }),
    );

    const [, subject, html] = mockNotificationService.sendTransactional.mock.calls[0] as [
      string,
      string,
      string,
    ];
    expect(subject).toContain('Billing');
    expect(html).toContain('Alex Visitor');
    expect(html).toContain('Question about my invoice.');
  });

  it('HTML-escapes submitted content so it cannot inject markup into the recipient email', async () => {
    await service.submit(dto({ name: '<img src=x onerror=alert(1)>' }));

    const [, , html] = mockNotificationService.sendTransactional.mock.calls[0] as [
      string,
      string,
      string,
    ];
    expect(html).not.toContain('<img src=x onerror=alert(1)>');
    expect(html).toContain('&lt;img');
  });

  // ─── Honeypot ────────────────────────────────────────────────────────────

  it('silently discards a submission with the honeypot field filled — no email sent, no error thrown', async () => {
    await expect(service.submit(dto({ website: 'http://spam.example' }))).resolves.toBeUndefined();

    expect(mockNotificationService.sendTransactional).not.toHaveBeenCalled();
  });

  it('never logs the honeypot-triggered submission content, only that it happened', async () => {
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    await service.submit(dto({ website: 'http://spam.example', message: 'buy cheap watches' }));

    const loggedText = warnSpy.mock.calls.map((call) => String(call[0])).join('\n');
    expect(loggedText).not.toContain('buy cheap watches');
    warnSpy.mockRestore();
  });

  // ─── Recipient configuration ────────────────────────────────────────────

  it('throws a safe, generic error and never calls Resend when CONTACT_RECIPIENT_EMAIL is unset', async () => {
    mockConfig.get.mockReturnValue(undefined);

    await expect(service.submit(dto())).rejects.toThrow(ServiceUnavailableException);
    expect(mockNotificationService.sendTransactional).not.toHaveBeenCalled();
  });

  it('throws a safe, generic error and never calls Resend when CONTACT_RECIPIENT_EMAIL is still the .env.example placeholder value', async () => {
    mockConfig.get.mockReturnValue('placeholder@example.com'); // the literal .env.example default

    await expect(service.submit(dto())).rejects.toThrow(ServiceUnavailableException);
    expect(mockNotificationService.sendTransactional).not.toHaveBeenCalled();
  });

  it('never exposes the destination recipient address in a thrown error', async () => {
    mockConfig.get.mockReturnValue(undefined);

    await expect(service.submit(dto())).rejects.toMatchObject({
      message: expect.not.stringContaining('@') as unknown as string,
    });
  });

  // ─── Send failure ────────────────────────────────────────────────────────

  it('throws a safe, generic error when the email provider fails, and never logs the message content', async () => {
    const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    mockNotificationService.sendTransactional.mockRejectedValue(new Error('Resend API 500'));

    await expect(service.submit(dto({ message: 'do not leak this in logs' }))).rejects.toThrow(
      ServiceUnavailableException,
    );

    const loggedText = errorSpy.mock.calls.map((call) => String(call[0])).join('\n');
    expect(loggedText).not.toContain('do not leak this in logs');
    errorSpy.mockRestore();
  });
});
