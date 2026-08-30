import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { type Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { createClerkClient, type ClerkClient } from '@clerk/backend';

import { UserEntity } from '../../entities/user.entity';
import { ProfileEntity } from '../../entities/profile.entity';

@Injectable()
export class UserService {
  private readonly logger = new Logger(UserService.name);
  private readonly clerkClient: ClerkClient;

  constructor(
    @InjectRepository(UserEntity)
    private readonly userRepo: Repository<UserEntity>,
    @InjectRepository(ProfileEntity)
    private readonly profileRepo: Repository<ProfileEntity>,
    config: ConfigService,
  ) {
    this.clerkClient = createClerkClient({
      secretKey: config.getOrThrow<string>('CLERK_SECRET_KEY'),
    });
  }

  /**
   * Atomically insert-or-update a user from a Clerk webhook event.
   * Uses PostgreSQL ON CONFLICT to eliminate the TOCTOU race that would occur
   * if two concurrent Clerk webhook deliveries both tried to create the same user.
   */
  async findOrCreateByClerkId(clerkId: string, email: string): Promise<UserEntity> {
    await this.userRepo.upsert(
      { clerkId, email },
      { conflictPaths: ['clerkId'], skipUpdateIfNoValuesChanged: true },
    );
    return this.userRepo.findOneByOrFail({ clerkId });
  }

  /**
   * Resolves the local user row for an already Clerk-verified caller (ClerkGuard
   * has run before this is ever called). The `user.created` webhook is the primary
   * sync path, but delivery can lag — or, in local dev without a registered ngrok
   * tunnel, never arrive at all. Rather than hard-failing a legitimately
   * authenticated request, a missing row is treated as "not yet synced": we fetch
   * the profile from Clerk once and provision it through the same race-safe upsert
   * the webhook uses, so the two paths can never create duplicate/conflicting rows.
   */
  async findByClerkId(clerkId: string): Promise<UserEntity> {
    const user = await this.userRepo.findOne({
      where: { clerkId },
      relations: ['profile'],
    });
    if (user) return user;

    return this.provisionFromClerk(clerkId);
  }

  private async provisionFromClerk(clerkId: string): Promise<UserEntity> {
    let clerkUser;
    try {
      clerkUser = await this.clerkClient.users.getUser(clerkId);
    } catch {
      throw new NotFoundException('User not found');
    }

    const primaryEmail = clerkUser.emailAddresses.find(
      (e) => e.id === clerkUser.primaryEmailAddressId,
    );
    if (!primaryEmail) {
      this.logger.warn(`Clerk user ${clerkId} has no primary email — cannot provision locally`);
      throw new NotFoundException('User not found');
    }

    this.logger.log(
      `JIT-provisioning local user for Clerk id ${clerkId} (webhook sync pending or not configured)`,
    );
    return this.findOrCreateByClerkId(clerkId, primaryEmail.emailAddress);
  }

  async deleteByClerkId(clerkId: string): Promise<void> {
    const user = await this.findByClerkId(clerkId);
    await this.userRepo.softDelete(user.id);
    // TODO: schedule R2 CV file deletion, emit gdpr.erasure.requested event
  }
}
