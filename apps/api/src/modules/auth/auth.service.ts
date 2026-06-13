import { Injectable, Logger } from '@nestjs/common';

interface ClerkWebhookHeaders {
  svixId: string;
  svixTimestamp: string;
  svixSignature: string;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  async handleClerkWebhook(headers: ClerkWebhookHeaders, payload: unknown): Promise<void> {
    // TODO: verify Svix signature, then route event type to UserService
    this.logger.log('Clerk webhook received', { headers, payload });
  }
}
