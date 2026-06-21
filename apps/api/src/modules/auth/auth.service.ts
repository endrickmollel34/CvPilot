import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { Webhook } from 'svix';

import type { UserService } from '../user/user.service';

interface ClerkWebhookHeaders {
  svixId: string;
  svixTimestamp: string;
  svixSignature: string;
}

interface ClerkUserData {
  id: string;
  email_addresses: Array<{ email_address: string; id: string }>;
  primary_email_address_id: string;
}

interface ClerkWebhookEvent {
  type: string;
  data: ClerkUserData;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly userService: UserService,
  ) {}

  async handleClerkWebhook(
    headers: ClerkWebhookHeaders,
    rawBody: Buffer,
  ): Promise<{ received: boolean }> {
    const secret = this.config.getOrThrow<string>('CLERK_WEBHOOK_SECRET');
    const wh = new Webhook(secret);

    let event: ClerkWebhookEvent;
    try {
      event = wh.verify(rawBody.toString(), {
        'svix-id': headers.svixId,
        'svix-timestamp': headers.svixTimestamp,
        'svix-signature': headers.svixSignature,
      }) as ClerkWebhookEvent;
    } catch {
      throw new BadRequestException('Invalid Clerk webhook signature');
    }

    this.logger.log(`Clerk webhook: ${event.type}`);

    switch (event.type) {
      case 'user.created':
      case 'user.updated':
        await this.syncUser(event.data);
        break;
      case 'user.deleted':
        await this.deleteUser(event.data);
        break;
      default:
        this.logger.log(`Unhandled Clerk event: ${event.type}`);
    }

    return { received: true };
  }

  private async syncUser(data: ClerkUserData): Promise<void> {
    const primaryEmail = data.email_addresses.find((e) => e.id === data.primary_email_address_id);
    if (!primaryEmail) {
      this.logger.warn(`Clerk user ${data.id} has no primary email — skipping sync`);
      return;
    }
    await this.userService.findOrCreateByClerkId(data.id, primaryEmail.email_address);
  }

  private async deleteUser(data: ClerkUserData): Promise<void> {
    try {
      await this.userService.deleteByClerkId(data.id);
    } catch {
      // User may not exist locally yet (e.g., deleted before first sync)
      this.logger.warn(`Clerk user.deleted: no local record for ${data.id}`);
    }
  }
}
