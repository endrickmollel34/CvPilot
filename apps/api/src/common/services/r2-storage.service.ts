import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { S3Client, DeleteObjectCommand } from '@aws-sdk/client-s3';

/**
 * Small, stateless Cloudflare R2 (S3-compatible) helper shared by any
 * module that needs to delete an object it already owns a stored key for
 * (individual CV/cover-letter deletion — see the module report). Every
 * module that uploads/presigns still constructs its own S3Client for that
 * (CvService, CoverLetterService, UserService) — this deliberately narrow
 * service only centralizes the one operation that is genuinely identical
 * everywhere it's needed: an idempotent, never-throwing delete-by-key.
 *
 * This service has no opinion on ownership and deliberately never accepts
 * an arbitrary client-supplied key — callers must already have resolved
 * the key from an ownership-checked record (e.g. `cv.r2ObjectKey` after
 * `findOneForUser()`) before calling this.
 */
@Injectable()
export class R2StorageService {
  private readonly logger = new Logger(R2StorageService.name);
  private readonly s3: S3Client;
  private readonly bucket: string;

  constructor(config: ConfigService) {
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
   * Deletes one object by key. S3/R2's DeleteObject is itself idempotent —
   * deleting an already-missing key still succeeds (no NotFound error is
   * thrown for a missing object, unlike GetObject), so no separate
   * "does it exist first" check is needed here, and a caller retrying
   * after a previous success naturally still gets `true` back.
   *
   * Never throws: a genuinely unexpected failure (network, auth, bucket
   * misconfiguration) is caught and reported back as `false` — callers
   * that require the delete to have actually happened before proceeding
   * (individual CV/cover-letter deletion — see the module report) must
   * check this and stop rather than assume success.
   *
   * Privacy-safe logging fix: previously logged the full object key, which
   * — for a CV — embeds the original, user-controlled filename (e.g.
   * "jane-smith-cv-2024.pdf"), itself personal data. On failure this now
   * logs only the operation, the object's broad category (the key's own
   * first path segment, e.g. "cvs"/"cover-letters" — never the user id,
   * which is the *second* segment, or anything after it), and the error's
   * *name* (a fixed, enumerable SDK error type, e.g. "NoSuchBucket") —
   * never `.message`, which for some AWS SDK errors can itself echo back
   * request details like the key. Same reasoning already established for
   * Stripe SDK errors in UserService's own cancellation-failure logging.
   */
  async deleteObject(key: string): Promise<boolean> {
    try {
      await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
      return true;
    } catch (err) {
      const category = key.split('/')[0] || 'unknown';
      const errorType = err instanceof Error ? err.name : 'UnknownError';
      this.logger.warn(
        `R2 delete failed (category: ${category}, error: ${errorType}) — the object may now be ` +
          'orphaned in R2 and unreachable through the app.',
      );
      return false;
    }
  }
}
