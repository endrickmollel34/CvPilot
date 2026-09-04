import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { CONTACT_CATEGORY_LABELS } from '@cvpilot/shared';
import { NotificationService } from '../notification/notification.service';
import type { SubmitContactDto } from './dto/submit-contact.dto';

@Injectable()
export class ContactService {
  private readonly logger = new Logger(ContactService.name);

  constructor(
    private readonly notificationService: NotificationService,
    private readonly config: ConfigService,
  ) {}

  async submit(dto: SubmitContactDto): Promise<void> {
    // Honeypot: a real visitor never sees or fills this field. A bot that
    // does gets a normal-looking success response (never told why) while
    // nothing is sent, logged, or stored — see submit-contact.dto.ts.
    if (dto.website) {
      this.logger.warn('Contact form: honeypot field was filled — submission discarded');
      return;
    }

    // The recipient is never client-controlled — see SubmitContactDto,
    // which has no recipient/from field at all. It comes exclusively from
    // server-side config, resolved fresh on every submission (not cached
    // in a constructor field) so a missing/placeholder value fails loudly
    // rather than silently sending nowhere.
    const recipient = this.config.get<string>('CONTACT_RECIPIENT_EMAIL');
    if (!recipient || recipient.trim() === '' || recipient.includes('placeholder')) {
      this.logger.error(
        'Contact form submission received but CONTACT_RECIPIENT_EMAIL is not configured — message was not sent',
      );
      throw new ServiceUnavailableException(
        'The contact form is not available right now. Please try again later.',
      );
    }

    // Never log the name, email, or message body — only the category and
    // the fact that a submission occurred. Sufficient to see contact-form
    // traffic/abuse patterns in logs without logging personal data.
    this.logger.log(`Contact form submission received (category: ${dto.category})`);

    try {
      await this.notificationService.sendTransactional(
        recipient,
        `CVPilot contact form — ${CONTACT_CATEGORY_LABELS[dto.category]}`,
        this.buildHtml(dto),
        dto.email, // Reply-To — never `from`, see NotificationService's comment on SPF/DMARC.
      );
    } catch (err) {
      // Only the error's type is logged, matching the rest of the codebase's
      // convention for third-party SDK failures (e.g. StripePaymentProvider,
      // UserService) — an SDK error message isn't a guaranteed-safe value to
      // log, and never log the submission content on failure either.
      const errorType = err instanceof Error ? err.name : 'UnknownError';
      this.logger.error(`Contact form email failed to send (${errorType})`);
      throw new ServiceUnavailableException(
        'We could not send your message right now. Please try again later.',
      );
    }
  }

  private buildHtml(dto: SubmitContactDto): string {
    const submittedAt = new Date().toISOString();
    return `
      <h2>New CVPilot contact form submission</h2>
      <p><strong>Name:</strong> ${escapeHtml(dto.name)}</p>
      <p><strong>Email:</strong> ${escapeHtml(dto.email)}</p>
      <p><strong>Category:</strong> ${escapeHtml(CONTACT_CATEGORY_LABELS[dto.category])}</p>
      <p><strong>Submitted:</strong> ${submittedAt}</p>
      <p><strong>Message:</strong></p>
      <p>${escapeHtml(dto.message).replace(/\n/g, '<br>')}</p>
    `.trim();
  }
}

// Minimal HTML-entity escaping for user-supplied content dropped into an
// HTML email body — prevents a submitted name/email/message from injecting
// markup into the recipient's email client. No templating library needed
// for five characters.
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
