import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);
  private readonly resend: Resend;

  constructor(private readonly config: ConfigService) {
    this.resend = new Resend(this.config.getOrThrow<string>('RESEND_API_KEY'));
  }

  @OnEvent('analysis.completed')
  async onAnalysisCompleted(payload: { analysisId: string; userEmail?: string }) {
    this.logger.log(`Analysis ${payload.analysisId} completed — sending notification`);
    // TODO: fetch user email from UserService, send result-ready email via Resend
  }

  async sendTransactional(to: string, subject: string, html: string): Promise<void> {
    await this.resend.emails.send({
      from: this.config.getOrThrow<string>('RESEND_FROM_EMAIL'),
      to,
      subject,
      html,
    });
  }
}
