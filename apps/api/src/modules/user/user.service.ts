import { Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { type Repository, type DataSource } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { createClerkClient, type ClerkClient } from '@clerk/backend';
import { S3Client, DeleteObjectCommand } from '@aws-sdk/client-s3';

import { UserEntity } from '../../entities/user.entity';
import { ProfileEntity } from '../../entities/profile.entity';
import { CvEntity } from '../../entities/cv.entity';
import { CoverLetterEntity } from '../../entities/cover-letter.entity';
import { AnalysisEntity } from '../../entities/analysis.entity';
import { TailoringEntity } from '../../entities/tailoring.entity';
import { SubscriptionEntity } from '../../entities/subscription.entity';
import { StripePaymentProvider } from '../billing/providers/stripe.provider';

/**
 * What to do if cancelling the user's Stripe subscription fails during
 * account deletion:
 *   - 'abort'    — self-service DELETE /users/me. The Clerk identity still
 *      exists, so the user can retry; nothing is erased until billing is
 *      confirmed stopped.
 *   - 'continue' — the Clerk user.deleted webhook. The Clerk account is
 *      already gone by the time this runs, so there is no user-facing
 *      retry surface — erasure proceeds anyway rather than leaving CVPilot
 *      personal data permanently stuck, and the failure is logged loudly
 *      for manual Stripe follow-up.
 */
export type CancellationFailureBehavior = 'abort' | 'continue';

@Injectable()
export class UserService {
  private readonly logger = new Logger(UserService.name);
  private readonly clerkClient: ClerkClient;
  private readonly s3: S3Client;
  private readonly bucket: string;

  constructor(
    @InjectRepository(UserEntity)
    private readonly userRepo: Repository<UserEntity>,
    @InjectRepository(ProfileEntity)
    private readonly profileRepo: Repository<ProfileEntity>,
    @InjectRepository(CvEntity)
    private readonly cvRepo: Repository<CvEntity>,
    @InjectRepository(CoverLetterEntity)
    private readonly coverLetterRepo: Repository<CoverLetterEntity>,
    @InjectRepository(SubscriptionEntity)
    private readonly subscriptionRepo: Repository<SubscriptionEntity>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly stripeProvider: StripePaymentProvider,
    config: ConfigService,
  ) {
    this.clerkClient = createClerkClient({
      secretKey: config.getOrThrow<string>('CLERK_SECRET_KEY'),
    });

    this.s3 = new S3Client({
      region: 'auto',
      endpoint: config.getOrThrow<string>('CLOUDFLARE_R2_ENDPOINT'),
      credentials: {
        accessKeyId: config.getOrThrow<string>('CLOUDFLARE_R2_ACCESS_KEY_ID'),
        secretAccessKey: config.getOrThrow<string>('CLOUDFLARE_R2_SECRET_ACCESS_KEY'),
      },
    });
    this.bucket = config.getOrThrow<string>('CLOUDFLARE_R2_BUCKET_NAME');
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
      this.logger.log(`No local row and Clerk lookup failed for ${clerkId}`);
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

  /**
   * Real account-data erasure, shared by the self-service `DELETE /users/me`
   * endpoint and the Clerk `user.deleted` webhook. Erases every CVPilot
   * personal-data record owned by this user: CVs (incl. their R2 files),
   * analyses (and their ATS reports, via cascade), cover letters (incl.
   * their R2 PDF files, if downloaded), tailorings, and the user/profile
   * row itself.
   *
   * Before any of that, an active Stripe subscription is cancelled first
   * (see cancelActiveSubscription()) — the customer must not keep being
   * billed for a CVPilot account whose data has been erased. Only the
   * local `subscriptions`/`payments` rows are touched by the DB erasure
   * itself; they cascade-delete along with the user row per their existing
   * FK definitions (InitialSchema migration). `cancellationFailure`
   * controls what happens if the Stripe API call fails — see
   * CancellationFailureBehavior's docstring.
   */
  async deleteByClerkId(
    clerkId: string,
    cancellationFailure: CancellationFailureBehavior = 'abort',
  ): Promise<void> {
    const user = await this.findByClerkId(clerkId);
    this.logger.log(`Account erasure: user lookup found ${user.id} for Clerk id ${clerkId}`);

    await this.cancelActiveSubscription(user.id, cancellationFailure);

    // Collect R2 object keys before any relational deletion — includes
    // previously soft-deleted CVs (a user may have "deleted" a CV earlier,
    // which today only soft-deletes it; genuine erasure must still clean
    // up its file). Cover letters only have an R2 object once downloaded.
    const [cvs, coverLetters] = await Promise.all([
      this.cvRepo.find({ where: { userId: user.id }, withDeleted: true }),
      this.coverLetterRepo.find({ where: { userId: user.id }, withDeleted: true }),
    ]);
    const objectKeys = [...cvs, ...coverLetters]
      .map((row) => row.r2ObjectKey)
      .filter((key): key is string => !!key);

    // Relational erasure, in one transaction, in FK-dependency order:
    //   1. tailorings — its master_cv_id/tailored_cv_id FKs to cvs have no
    //      ON DELETE CASCADE (unlike every other user-owned table's FKs —
    //      see migrations/1750500000000-TailoringTable.ts), so a tailoring
    //      row referencing this user's CVs must be removed before those
    //      CVs are deleted, or the CV delete would be rejected.
    //   2. cover_letters, 3. analyses (ats_reports cascade automatically
    //      via analyses' own ON DELETE CASCADE), 4. cvs — all safe once
    //      tailorings are gone.
    //   5. the user row itself — cascades profiles/subscriptions/payments/
    //      notifications automatically (all plain ON DELETE CASCADE with
    //      nothing else referencing them, per InitialSchema).
    // This is deliberately explicit rather than relying solely on the
    // user-row cascade, so the deletion order is self-documenting and
    // testable, and doesn't depend on Postgres's multi-path cascade
    // resolution order being exactly what's assumed above.
    // Errors here are deliberately NOT swallowed — this is the one step that
    // makes erasure irreversible-safe: if the transaction fails (deadlock,
    // lock-wait timeout, connectivity blip, whatever), we must NOT continue
    // to R2 cleanup, and the caller (AuthService, for the Clerk webhook path)
    // must see this failure so it reports non-2xx and Clerk retries — a
    // silently-swallowed failure here is exactly what previously left rows
    // permanently un-erased with no signal to retry.
    try {
      await this.dataSource.transaction(async (manager) => {
        await manager.delete(TailoringEntity, { userId: user.id });
        await manager.delete(CoverLetterEntity, { userId: user.id });
        await manager.delete(AnalysisEntity, { userId: user.id });
        await manager.delete(CvEntity, { userId: user.id });
        await manager.delete(UserEntity, { id: user.id });
      });
    } catch (err) {
      const errorType = err instanceof Error ? err.name : 'UnknownError';
      this.logger.error(
        `Account erasure: DB transaction FAILED for user ${user.id} (${errorType}) — ` +
          'no rows were erased (transaction rolled back); R2 cleanup was not attempted.',
      );
      throw err;
    }
    this.logger.log(`Account erasure: DB transaction committed for user ${user.id}`);

    // R2 deletion only after the DB transaction has committed. Tradeoff:
    // deleting R2 objects first (or inside the transaction) risks a
    // committed-but-still-referenced state if the DB step later failed —
    // CV/cover-letter rows pointing at files that no longer exist, which
    // could break downstream reads. Deleting R2 objects after commit risks
    // the opposite: if R2 cleanup fails here, the DB erasure has already
    // succeeded (irreversible) and a small number of orphaned files may be
    // left in the bucket, unreferenced by any row and unreachable through
    // the app. The second failure mode is strictly safer — an orphaned
    // file is a cheap, non-user-facing cleanup problem; a dangling DB
    // reference to a missing file is a broken user-facing one. So erasure
    // is considered successful once the DB transaction commits; R2
    // failures are logged, not thrown.
    if (objectKeys.length === 0) {
      this.logger.log(`Account erasure: no R2 objects to delete for user ${user.id}`);
      return;
    }
    this.logger.log(
      `Account erasure: R2 cleanup attempted — ${objectKeys.length} object(s) for user ${user.id}`,
    );
    const results = await Promise.all(objectKeys.map((key) => this.deleteR2ObjectSafely(key)));
    const succeeded = results.filter(Boolean).length;
    this.logger.log(
      `Account erasure: R2 cleanup completed for user ${user.id} — ${succeeded}/${objectKeys.length} object(s) deleted`,
    );
  }

  /**
   * Cancels the user's Stripe subscription if one exists and isn't already
   * cancelled. Reuses the existing StripePaymentProvider.cancelSubscription
   * — no second cancellation implementation. Free users / no subscription
   * row / an already-cancelled subscription are all no-ops (nothing to
   * cancel — every non-'cancelled' status, including active, trialing,
   * past_due, incomplete, and active+cancelAtPeriodEnd, is treated
   * uniformly: if it's not already cancelled and a provider subscription
   * id exists, attempt to cancel it).
   */
  private async cancelActiveSubscription(
    userId: string,
    cancellationFailure: CancellationFailureBehavior,
  ): Promise<void> {
    const sub = await this.subscriptionRepo.findOneBy({ userId });
    if (!sub?.providerSubscriptionId || sub.status === 'cancelled') {
      this.logger.log(
        `Account erasure: no active Stripe subscription to cancel for user ${userId}`,
      );
      return;
    }

    this.logger.log(
      `Account erasure: Stripe cancellation attempted for subscription ${sub.providerSubscriptionId} (user ${userId})`,
    );
    try {
      await this.stripeProvider.cancelSubscription(sub.providerSubscriptionId);
      this.logger.log(
        `Account erasure: Stripe cancellation completed for subscription ${sub.providerSubscriptionId} (user ${userId})`,
      );
    } catch (err) {
      // Only the error's *type* is logged, never its message — an SDK
      // error's message text is not a guaranteed-safe value (it could in
      // principle echo back request detail), unlike its constructor name.
      // The subscription id is not a secret and is required here so an
      // operator can locate/cancel it manually.
      const errorType = err instanceof Error ? err.name : 'UnknownError';

      if (cancellationFailure === 'abort') {
        this.logger.error(
          `Account deletion aborted: failed to cancel subscription ${sub.providerSubscriptionId} ` +
            `for user ${userId} (${errorType})`,
        );
        throw new ServiceUnavailableException(
          "We couldn't cancel your subscription right now. Please try again in a moment, or contact support.",
        );
      }

      this.logger.error(
        `Failed to cancel subscription ${sub.providerSubscriptionId} for user ${userId} during ` +
          `Clerk-triggered account deletion (${errorType}) — proceeding with data erasure anyway. ` +
          'MANUAL STRIPE CANCELLATION MAY BE REQUIRED.',
      );
    }
  }

  private async deleteR2ObjectSafely(key: string): Promise<boolean> {
    try {
      await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
      return true;
    } catch (err) {
      // Log only the object key (a storage path, not a secret) and the
      // error message — never credentials, never file contents.
      this.logger.warn(
        `Account erasure: failed to delete R2 object "${key}" (${err instanceof Error ? err.message : 'unknown error'}). ` +
          'The database record for this file has already been erased; the object is now orphaned in R2 and unreachable through the app.',
      );
      return false;
    }
  }
}
