import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Webhook } from 'svix';

import { UserService } from '../user/user.service';

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
      // 'continue': the Clerk account is already gone by the time this
      // webhook arrives, so there is no user-facing surface left to retry
      // a failed Stripe cancellation through — see
      // UserService.CancellationFailureBehavior.
      await this.userService.deleteByClerkId(data.id, 'continue');
      this.logger.log(`Clerk webhook: erasure complete for ${data.id}`);
    } catch (err) {
      if (err instanceof NotFoundException) {
        // Genuinely nothing to erase — either this user was deleted by an
        // earlier delivery of this same webhook (Clerk retries are common
        // and must be idempotent), or the local row was never synced in the
        // first place. Either way there is no local record, so this is a
        // benign no-op, not a failure.
        this.logger.log(`Clerk webhook: no local record for ${data.id} — nothing to erase`);
        return;
      }

      // Any other failure (DB/transaction error, connectivity issue, etc.)
      // must NOT be swallowed here: this used to catch everything and
      // always report success, which meant a real erasure failure left the
      // user's row (and all their data) permanently un-erased with Clerk
      // never retrying, because it had already been told the webhook
      // succeeded. Rethrowing lets the controller surface a non-2xx
      // response so Clerk's own webhook retry policy kicks in. Only the
      // error's type is logged — see cancelActiveSubscription's identical
      // rationale in UserService.
      const errorType = err instanceof Error ? err.name : 'UnknownError';
      this.logger.error(
        `Clerk webhook: erasure FAILED for ${data.id} (${errorType}) — Clerk should retry this delivery`,
      );
      throw err;
    }
  }
}
