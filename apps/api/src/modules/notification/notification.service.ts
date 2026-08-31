import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';

import { resolveOptionalApiKey } from '../../common/utils/optional-api-key.util';

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);
  // Genuinely optional — email is not on any active CVPilot flow today (no
  // caller of sendTransactional exists yet, and onAnalysisCompleted is still
  // a TODO stub), so a missing/placeholder key must never block boot.
  // undefined means "not configured," not "broken."
  private readonly resend?: Resend;

  constructor(private readonly config: ConfigService) {
    const resendKey = resolveOptionalApiKey(config, 'RESEND_API_KEY');
    this.resend = resendKey ? new Resend(resendKey) : undefined;
  }

  @OnEvent('analysis.completed')
  async onAnalysisCompleted(payload: { analysisId: string; userEmail?: string }) {
    this.logger.log(`Analysis ${payload.analysisId} completed — sending notification`);
    // TODO: fetch user email from UserService, send result-ready email via Resend
  }

  async sendTransactional(to: string, subject: string, html: string): Promise<void> {
    if (!this.resend) {
      this.logger.warn(
        `Email not sent — Resend is not configured (to: ${to}, subject: "${subject}")`,
      );
      return;
    }

    await this.resend.emails.send({
      from: this.config.getOrThrow<string>('RESEND_FROM_EMAIL'),
      to,
      subject,
      html,
    });
  }
}
