import { randomUUID } from 'crypto';

import {
  BadRequestException,
  ConflictException,
  Injectable,
  ForbiddenException,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { type Repository, type DataSource, In } from 'typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  PutObjectCommand,
  HeadObjectCommand,
  CopyObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

import { PLAN_LIMITS } from '@cvpilot/shared';
import type { CvContent } from '@cvpilot/shared';
import { CvEntity } from '../../entities/cv.entity';
import { isDevQuotaBypassActive } from '../../common/utils/dev-quota-bypass.util';
import { UserService } from '../user/user.service';
import { BillingService } from '../billing/billing.service';
import { PrefillExtractionService } from './prefill-extraction.service';
import { PrefillLockService } from './prefill-lock.service';
import { PdfGenerationService } from './pdf-generation.service';
import { CvPhotoService } from './cv-photo.service';
import { R2StorageService } from '../../common/services/r2-storage.service';
import type { GenerateUploadUrlDto } from './dto/generate-upload-url.dto';
import { MAX_FILE_SIZE_BYTES } from './dto/generate-upload-url.dto';
import type { ConfirmUploadDto } from './dto/confirm-upload.dto';
import type { CreateCvDto } from './dto/create-cv.dto';
import type { UpdateCvContentDto } from './dto/update-cv-content.dto';
import type { RenameCvDto } from './dto/rename-cv.dto';
import type { ReorderCvSectionsDto } from './dto/reorder-cv-sections.dto';
import type { UpdateCvTemplateDto } from './dto/update-cv-template.dto';

const PRESIGNED_URL_TTL_SECONDS = 900; // 15 minutes

// Pre-launch gap closed here (RABBIT_NOTEBOOK.md §27): the "Idempotency:
// return existing prefill CV for this upload" check below reused results
// correctly for SEQUENTIAL calls, but two REQUESTS RACING for the same
// uploadCvId (a double-click, a retried request after a slow response,
// two browser tabs) could both read "no existing row" before either had
// saved one — both then call the real, paid OpenAI extraction and both
// create a CV row, silently doubling AI cost and double-counting against
// PLAN_LIMITS.builderCvsTotal for one logical prefill. Guarded with a
// per-uploadCvId PrefillLockService lock (SET NX to acquire) — generous
// relative to a realistic OpenAI call so it's never the cause of a false
// rejection, but bounded so a crashed request can't wedge this
// uploadCvId forever.
const PREFILL_LOCK_TTL_MS = 60_000;
// §28: a fixed TTL alone isn't enough — PrefillExtractionService retries
// up to 3 times with no explicit per-call timeout (the OpenAI SDK's own
// default is several minutes), so a slow/degraded OpenAI response can
// legitimately make one prefillFromUpload call run longer than 60s.
// Verified directly (prefill-lock.service.spec.ts's "DEMONSTRATED GAP"
// test) that a fixed-TTL lock with no renewal silently expires out from
// under a still-running operation, letting a second caller acquire the
// "same" lock. This heartbeat re-extends the lock well before its TTL
// would elapse, for as long as the AI call is genuinely still in flight —
// see prefill-lock.service.spec.ts's "FIX VERIFIED" test for direct proof
// this keeps the lock held past what the fixed TTL alone would allow, and
// PrefillLockService's own doc comment for why a crashed process is still
// safe (the heartbeat just stops, the TTL still expires on its own).
const PREFILL_LOCK_RENEW_INTERVAL_MS = 20_000;

// §28: the OTHER concurrency gap this session's investigation found — two
// DIFFERENT builder-CV-creating operations for the SAME user (two
// different uploads both being prefilled, or a manual createBuilder()
// racing a prefillFromUpload()) could both read the SAME (under-limit)
// PLAN_LIMITS.builderCvsTotal count before either had inserted its row,
// since checkBuilderCvLimit()'s count-then-allow was never itself atomic
// across callers. This lock is per-userId (not per-upload — §27's lock
// above doesn't cover cross-upload/cross-path races at all) and only ever
// protects a fast count+insert (no AI call inside it), so a short, fixed
// TTL with no renewal is sufficient here — verified via
// cv.service.spec.ts's own concurrency tests.
const BUILDER_CV_QUOTA_LOCK_TTL_MS = 10_000;
const BUILDER_CV_QUOTA_LOCK_ACQUIRE_RETRIES = 10;
const BUILDER_CV_QUOTA_LOCK_ACQUIRE_RETRY_DELAY_MS = 75;

@Injectable()
export class CvService {
  private readonly logger = new Logger(CvService.name);
  private readonly s3: S3Client;
  private readonly bucket: string;
  private readonly r2Configured: boolean;

  constructor(
    @InjectRepository(CvEntity)
    private readonly cvRepo: Repository<CvEntity>,
    @InjectQueue('cv-parsing')
    private readonly parsingQueue: Queue,
    private readonly config: ConfigService,
    private readonly userService: UserService,
    private readonly billingService: BillingService,
    private readonly prefillService: PrefillExtractionService,
    private readonly prefillLockService: PrefillLockService,
    private readonly pdfService: PdfGenerationService,
    private readonly cvPhotoService: CvPhotoService,
    private readonly r2Storage: R2StorageService,
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {
    const endpoint = this.config.getOrThrow<string>('CLOUDFLARE_R2_ENDPOINT');
    const accessKeyId = this.config.getOrThrow<string>('CLOUDFLARE_R2_ACCESS_KEY_ID');
    const secretAccessKey = this.config.getOrThrow<string>('CLOUDFLARE_R2_SECRET_ACCESS_KEY');
    this.bucket = this.config.getOrThrow<string>('CLOUDFLARE_R2_BUCKET_NAME');

    this.r2Configured = ![endpoint, accessKeyId, secretAccessKey, this.bucket].some((v) =>
      v.includes('placeholder'),
    );
    if (!this.r2Configured) {
      this.logger.warn(
        'CLOUDFLARE_R2_* env vars are placeholders — CV upload requests will be rejected ' +
          'with a clear error until real Cloudflare R2 credentials are configured in apps/api/.env.',
      );
    }

    this.s3 = new S3Client({
      region: 'auto',
      endpoint,
      credentials: { accessKeyId, secretAccessKey },
    });
  }

  async generateUploadUrl(clerkId: string, dto: GenerateUploadUrlDto) {
    if (!this.r2Configured) {
      throw new ServiceUnavailableException(
        'File storage is not configured for this environment. Set CLOUDFLARE_R2_* in apps/api/.env to enable CV uploads.',
      );
    }

    const user = await this.userService.findByClerkId(clerkId);

    const canProceed = await this.billingService.canPerformAction(user.id, 'analyse');
    if (!canProceed) {
      throw new ForbiddenException(
        'Monthly analysis limit reached. Upgrade your plan to continue.',
      );
    }

    // Uploaded straight into a dedicated pending-cvs/ prefix, never directly
    // into the permanent cvs/ prefix — see confirmUpload() below for why:
    // the declared fileSizeBytes above is client-supplied and unverified,
    // so nothing under this key is treated as a real, usable CV until a
    // HEAD-verified copy has been promoted to cvs/. pending-cvs/ is the
    // exact (and only) prefix an R2 lifecycle rule should target, so an
    // abandoned/never-confirmed pending object is automatically reclaimed
    // without any risk to confirmed CVs living under cvs/.
    const safeFileName = dto.fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
    const r2ObjectKey = `pending-cvs/${user.id}/${randomUUID()}-${safeFileName}`;

    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: r2ObjectKey,
      ContentType: dto.mimeType,
    });

    const uploadUrl = await getSignedUrl(this.s3, command, {
      expiresIn: PRESIGNED_URL_TTL_SECONDS,
    });

    return { uploadUrl, r2ObjectKey };
  }

  /**
   * Verified-size pending-upload flow (see the upload-hardening audit
   * report): dto.fileSizeBytes is client-declared and was never trustworthy
   * — a browser PUT to a presigned URL has no server-side size enforcement
   * (the presigned PutObjectCommand only signs Bucket/Key/ContentType, never
   * ContentLength), so a malicious client could previously claim any size
   * ≤5 MB while actually uploading an arbitrarily large object. The pending
   * object is now HEAD-verified here — the ONLY authoritative size is
   * whatever R2 itself reports back for the bytes actually stored — before
   * it is ever promoted to a permanent key, written to the DB, or handed to
   * ParsingService (which unconditionally buffers the whole object into
   * memory; an unverified oversized object must never reach it).
   */
  async confirmUpload(clerkId: string, dto: ConfirmUploadDto) {
    const user = await this.userService.findByClerkId(clerkId);

    // The presigned URL issued by generateUploadUrl always scopes the R2 key
    // under this exact pending-cvs/ prefix; a client submitting a key
    // outside its own namespace (someone else's, or a malformed one, or one
    // already promoted to the permanent cvs/ prefix) is rejected rather
    // than trusted. Deliberately generic error: this must not confirm or
    // deny another user's key even exists.
    const pendingPrefix = `pending-cvs/${user.id}/`;
    if (!dto.r2ObjectKey.startsWith(pendingPrefix)) {
      throw new ForbiddenException('Invalid upload reference.');
    }
    const pendingKey = dto.r2ObjectKey;

    let actualSizeBytes: number;
    try {
      const head = await this.s3.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: pendingKey }),
      );
      if (typeof head.ContentLength !== 'number' || !Number.isFinite(head.ContentLength)) {
        this.logger.warn('R2 HEAD returned no usable ContentLength during confirmUpload');
        throw new ServiceUnavailableException(
          "We couldn't verify the uploaded file right now. Please try again.",
        );
      }
      actualSizeBytes = head.ContentLength;
    } catch (err) {
      if (err instanceof ServiceUnavailableException) throw err;
      if (err instanceof Error && err.name === 'NotFound') {
        throw new NotFoundException('Uploaded file not found. Please try uploading again.');
      }
      const errorType = err instanceof Error ? err.name : 'UnknownError';
      this.logger.warn(`R2 HEAD failed during confirmUpload (error: ${errorType})`);
      throw new ServiceUnavailableException(
        "We couldn't verify the uploaded file right now. Please try again.",
      );
    }

    if (actualSizeBytes > MAX_FILE_SIZE_BYTES) {
      await this.r2Storage.deleteObject(pendingKey);
      throw new UnprocessableEntityException('CV files must be 5 MB or smaller.');
    }

    // Promote: R2 has no rename, so this is a copy-to-permanent-key followed
    // by best-effort pending-key cleanup. The permanent key reuses the exact
    // same (already-UUID-unique) suffix the pending key was created with —
    // no new UUID is generated here — so promotion can never collide with
    // or overwrite another CV's object.
    const permanentKey = `cvs/${user.id}/${pendingKey.slice(pendingPrefix.length)}`;
    try {
      // CopySource is sent by the SDK verbatim as the x-amz-copy-source
      // header — it does NOT get percent-encoded by @aws-sdk/client-s3
      // (verified directly against the installed SDK version: a manually
      // encodeURIComponent()-ed value comes out the other end with its `/`
      // separators turned into literal `%2F`, which R2/S3 does not
      // re-decode, breaking the bucket/key split the API expects). The
      // official AWS SDK v3 examples pass `${bucket}/${key}` raw for exactly
      // this reason. This app's own key charset is already fully
      // pre-sanitized (see safeFileName above and randomUUID()), so no
      // character in pendingKey ever needs percent-encoding in the first
      // place — there is nothing here for manual encoding to legitimately
      // protect against.
      await this.s3.send(
        new CopyObjectCommand({
          Bucket: this.bucket,
          CopySource: `${this.bucket}/${pendingKey}`,
          Key: permanentKey,
        }),
      );
    } catch (err) {
      const errorType = err instanceof Error ? err.name : 'UnknownError';
      this.logger.warn(`R2 promote-copy failed during confirmUpload (error: ${errorType})`);
      throw new ServiceUnavailableException("We couldn't finish saving your CV. Please try again.");
    }
    // Best-effort — a leftover pending object is harmless (never referenced
    // by any DB row) and self-cleans via the pending-cvs/ lifecycle rule.
    await this.r2Storage.deleteObject(pendingKey);

    const cv = this.cvRepo.create({
      userId: user.id,
      source: 'upload',
      fileName: dto.fileName,
      r2ObjectKey: permanentKey,
      fileSizeBytes: actualSizeBytes,
      mimeType: dto.mimeType,
      parseStatus: 'pending',
    });

    let saved: CvEntity;
    try {
      saved = await this.cvRepo.save(cv);
    } catch (err) {
      // The permanent object now exists but no DB row will ever reference
      // it — clean it up rather than leave an orphan. Best-effort: if this
      // also fails, R2StorageService.deleteObject() already logs it, and
      // the object is otherwise unreachable through the app either way.
      await this.r2Storage.deleteObject(permanentKey);
      throw err;
    }

    await this.parsingQueue.add('parse-cv', { cvId: saved.id });
    return saved;
  }

  async createBuilder(clerkId: string, dto: CreateCvDto): Promise<CvEntity> {
    const user = await this.userService.findByClerkId(clerkId);

    // §28: check-then-insert under a per-user lock — see
    // withBuilderCvQuotaLock's own doc comment for why the plain
    // checkBuilderCvLimit() this used to call directly isn't race-safe
    // across two concurrent builder-CV-creating calls for the same user.
    return this.withBuilderCvQuotaLock(user.id, async () => {
      const cv = this.cvRepo.create({
        userId: user.id,
        title: dto.title,
        source: dto.source ?? 'builder',
        parseStatus: 'done',
        isActive: true,
      });
      return this.cvRepo.save(cv);
    });
  }

  async updateContent(clerkId: string, cvId: string, dto: UpdateCvContentDto): Promise<CvEntity> {
    const cv = await this.findOneForUser(clerkId, cvId);
    if (cv.source === 'upload') {
      throw new ForbiddenException('Uploaded CVs cannot be edited in the builder.');
    }
    this.validateReferencesContent(dto.content);
    this.validateProfileFields(dto.content);
    await this.cvRepo.update(cvId, { content: dto.content });
    return this.cvRepo.findOneByOrFail({ id: cvId });
  }

  /**
   * Same targeted, defense-in-depth approach as validateReferencesContent
   * (see its own doc comment) — this only validates the fields the Profile
   * template feature actually adds (`qualities`, `personalDetails.
   * nationality`, `skills[].rating`/`languages[].rating`), read as
   * `unknown` rather than trusting the compile-time `CvContent` type.
   * Every other CV field remains exactly as unvalidated as before.
   */
  private validateProfileFields(content: CvContent): void {
    const raw = content as unknown as Record<string, unknown>;
    const MAX_FIELD_LENGTH = 255;
    const MAX_QUALITIES = 40;

    const qualities = raw['qualities'];
    if (qualities !== undefined) {
      if (!Array.isArray(qualities)) {
        throw new BadRequestException('qualities must be an array.');
      }
      if (qualities.length > MAX_QUALITIES) {
        throw new BadRequestException('Too many qualities.');
      }
      qualities.forEach((q: unknown, i: number) => {
        if (typeof q !== 'string' || !q.trim() || q.length > MAX_FIELD_LENGTH) {
          throw new BadRequestException(`qualities[${i}] must be a non-empty string.`);
        }
      });
    }

    const pd = raw['personalDetails'] as Record<string, unknown> | undefined;
    const nationality = pd?.['nationality'];
    if (
      nationality !== undefined &&
      (typeof nationality !== 'string' || nationality.length > MAX_FIELD_LENGTH)
    ) {
      throw new BadRequestException('personalDetails.nationality is invalid.');
    }

    for (const field of ['skills', 'languages'] as const) {
      const entries = raw[field];
      if (!Array.isArray(entries)) continue;
      entries.forEach((entry: unknown, i: number) => {
        if (!entry || typeof entry !== 'object') return;
        const rating = (entry as Record<string, unknown>)['rating'];
        if (rating === undefined) return;
        if (typeof rating !== 'number' || !Number.isInteger(rating) || rating < 1 || rating > 5) {
          throw new BadRequestException(`${field}[${i}].rating must be an integer from 1 to 5.`);
        }
      });
    }
  }

  /**
   * UpdateCvContentDto only validates that `content` is an object (see its
   * own file) — the whole-CV autosave payload has never been deeply
   * validated server-side, and doing that generally for every existing
   * field is out of scope here (see the References feature report). This
   * targets only the two fields this feature actually adds, so malformed
   * reference data specifically can never reach persistence even though
   * the rest of `content` still isn't deeply validated: `references` must
   * be an array of objects each carrying a non-empty `fullName` (the one
   * required field per the product spec) and, when present, a
   * syntactically valid `email`; every other field is optional free text
   * with a generous length cap against abuse.
   */
  private validateReferencesContent(content: CvContent): void {
    // Nominally typed as CvContent, but nothing upstream actually verifies
    // that shape at runtime (see UpdateCvContentDto) — read defensively as
    // unknown rather than trusting the compile-time type, so a malformed
    // payload is genuinely rejected rather than silently persisted.
    const raw = content as unknown as Record<string, unknown>;
    const referencesAvailableUponRequest = raw['referencesAvailableUponRequest'];
    if (
      referencesAvailableUponRequest !== undefined &&
      typeof referencesAvailableUponRequest !== 'boolean'
    ) {
      throw new BadRequestException('referencesAvailableUponRequest must be a boolean.');
    }

    const references = raw['references'];
    if (references === undefined) return;
    if (!Array.isArray(references)) {
      throw new BadRequestException('references must be an array.');
    }

    const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const MAX_FIELD_LENGTH = 255;
    const OPTIONAL_STRING_FIELDS = ['jobTitle', 'company', 'phone', 'relationship'] as const;

    references.forEach((entry: unknown, i: number) => {
      if (!entry || typeof entry !== 'object') {
        throw new BadRequestException(`references[${i}] must be an object.`);
      }
      const r = entry as Record<string, unknown>;

      if (typeof r['id'] !== 'string' || !r['id']) {
        throw new BadRequestException(`references[${i}].id is required.`);
      }
      if (typeof r['fullName'] !== 'string' || !(r['fullName'] as string).trim()) {
        throw new BadRequestException(`references[${i}].fullName is required.`);
      }
      if ((r['fullName'] as string).length > MAX_FIELD_LENGTH) {
        throw new BadRequestException(`references[${i}].fullName is too long.`);
      }

      for (const field of OPTIONAL_STRING_FIELDS) {
        const v = r[field];
        if (v !== undefined && (typeof v !== 'string' || v.length > MAX_FIELD_LENGTH)) {
          throw new BadRequestException(`references[${i}].${field} is invalid.`);
        }
      }

      if (r['email'] !== undefined) {
        const email = r['email'];
        if (typeof email !== 'string' || email.length > MAX_FIELD_LENGTH || !EMAIL_RE.test(email)) {
          throw new BadRequestException(`references[${i}].email is not a valid email address.`);
        }
      }
    });
  }

  async rename(clerkId: string, cvId: string, dto: RenameCvDto): Promise<CvEntity> {
    await this.findOneForUser(clerkId, cvId);
    await this.cvRepo.update(cvId, { title: dto.title });
    return this.cvRepo.findOneByOrFail({ id: cvId });
  }

  async reorderSections(
    clerkId: string,
    cvId: string,
    dto: ReorderCvSectionsDto,
  ): Promise<CvEntity> {
    const cv = await this.findOneForUser(clerkId, cvId);
    if (!cv.content) {
      throw new UnprocessableEntityException('CV has no content to reorder.');
    }
    await this.cvRepo.update(cvId, {
      content: { ...cv.content, sectionOrder: dto.sectionOrder },
    });
    return this.cvRepo.findOneByOrFail({ id: cvId });
  }

  async updateTemplate(clerkId: string, cvId: string, dto: UpdateCvTemplateDto): Promise<CvEntity> {
    const cv = await this.findOneForUser(clerkId, cvId);
    if (!cv.content) {
      throw new UnprocessableEntityException('CV has no builder content to apply a template to.');
    }
    // Presentation-only write — never touches `content`, so this can never
    // alter factual CV data (see cv.entity.ts's templateId doc comment).
    await this.cvRepo.update(cvId, { templateId: dto.templateId });
    return this.cvRepo.findOneByOrFail({ id: cvId });
  }

  /**
   * Privacy/retention fix (see the module report): "delete" previously
   * only soft-deleted the row — the original R2 file and the extracted
   * personal-data text (`content`/`parsedContent`) survived indefinitely,
   * hidden from the UI but never actually removed, until (if ever) the
   * user deleted their whole account.
   *
   * A CV row is deliberately NEVER hard-deleted here, even though this is
   * exactly what "delete" means for a cover letter (see
   * CoverLetterService.deleteCoverLetter()) — analyses.cv_id and
   * cover_letters.cv_id are both NOT NULL with ON DELETE CASCADE, so a
   * hard delete would silently cascade-destroy every analysis and cover
   * letter ever generated from this CV. That directly conflicts with this
   * product's own established design: both history lists already treat a
   * missing/soft-deleted source CV as a normal, expected state (LEFT
   * JOINs in AnalysisService/CoverLetterService/TailoringService's
   * listForUser(), explicitly so a deleted CV doesn't hide that history).
   * tailorings.master_cv_id/tailored_cv_id have no ON DELETE clause at all
   * (default RESTRICT), so a hard delete would additionally just fail
   * outright for any CV involved in a tailoring. See the module report's
   * dependency map for the full FK audit.
   *
   * So "delete" here means: keep the row (and its id, for existing FKs)
   * and its `deleted_at` soft-delete, but genuinely scrub the personal
   * data it held — cleared file metadata/content columns plus the actual
   * R2 object.
   *
   * Ordering fix (see the module report): the R2 object is deleted FIRST,
   * and the DB scrub only happens once that has genuinely succeeded. The
   * original order (DB first, R2 best-effort after) meant an R2 failure
   * could leave the actual file behind in R2 while CVPilot had already
   * cleared the one column (`r2ObjectKey`) that recorded which object
   * still needed cleanup — an unrecoverable, silent privacy gap, even
   * though the API had already reported success. R2's own DeleteObject is
   * idempotent (§ R2StorageService), so if this throws and the caller
   * retries later, the retry's R2 call is a harmless no-op success and the
   * DB scrub then completes normally — no compensation logic needed.
   */
  async deleteCv(clerkId: string, cvId: string): Promise<void> {
    const cv = await this.findOneForUser(clerkId, cvId);

    if (cv.r2ObjectKey) {
      const deleted = await this.r2Storage.deleteObject(cv.r2ObjectKey);
      if (!deleted) {
        throw new ServiceUnavailableException(
          "We couldn't delete this CV's stored file right now. Please try again in a moment.",
        );
      }
    }

    // Same privacy-scrub requirement as the CV file itself — a Profile
    // template photo is personal data too, so a soft-deleted CV must not
    // leave it behind in R2 either.
    if (cv.photoObjectKey) {
      const deleted = await this.r2Storage.deleteObject(cv.photoObjectKey);
      if (!deleted) {
        throw new ServiceUnavailableException(
          "We couldn't delete this CV's stored photo right now. Please try again in a moment.",
        );
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const clearedPersonalData: any = {
      content: null,
      parsedContent: null,
      fileName: null,
      r2ObjectKey: null,
      photoObjectKey: null,
    };
    // softDelete() + the content-scrub update happen atomically: a failure
    // partway through must not leave the row marked "deleted" while still
    // holding the personal-data text it should have cleared. If this
    // transaction itself fails after the R2 object was already deleted
    // above, the row is simply unchanged and the next delete attempt finds
    // `r2ObjectKey` still set — its R2 call is then a harmless idempotent
    // no-op (the object is already gone) and the DB scrub can complete.
    await this.dataSource.transaction(async (manager) => {
      await manager.softDelete(CvEntity, cvId);
      await manager.update(CvEntity, cvId, clearedPersonalData);
    });
  }

  async listForUser(clerkId: string) {
    const user = await this.userService.findByClerkId(clerkId);
    return this.cvRepo.find({
      where: { userId: user.id, isActive: true },
      order: { createdAt: 'DESC' },
    });
  }

  async findOneForUser(clerkId: string, cvId: string) {
    const user = await this.userService.findByClerkId(clerkId);
    const cv = await this.cvRepo.findOne({ where: { id: cvId, userId: user.id } });
    if (!cv) throw new NotFoundException(`CV ${cvId} not found`);
    return cv;
  }

  async findById(cvId: string) {
    const cv = await this.cvRepo.findOneBy({ id: cvId });
    if (!cv) throw new NotFoundException(`CV ${cvId} not found`);
    return cv;
  }

  async prefillFromUpload(clerkId: string, uploadCvId: string): Promise<CvEntity> {
    const user = await this.userService.findByClerkId(clerkId);

    const uploadCv = await this.cvRepo.findOne({ where: { id: uploadCvId, userId: user.id } });
    if (!uploadCv) throw new NotFoundException(`CV ${uploadCvId} not found`);

    if (uploadCv.source !== 'upload') {
      throw new UnprocessableEntityException(
        'Only uploaded CVs can be used to prefill a builder CV.',
      );
    }

    if (uploadCv.parseStatus !== 'done') {
      throw new UnprocessableEntityException(
        'CV text has not been fully extracted yet. Please try again in a moment.',
      );
    }

    if (!uploadCv.parsedContent?.trim()) {
      throw new UnprocessableEntityException(
        'No text was extracted from this CV. The file may be empty or unsupported.',
      );
    }

    // Idempotency: return existing prefill CV for this upload (non-deleted).
    // Cheap, lock-free check first — covers the common case (a page reload,
    // or the frontend simply calling this again after it already
    // succeeded) without any Redis round trip.
    const existing = await this.cvRepo.findOne({
      where: { sourceUploadCvId: uploadCvId, userId: user.id },
    });
    if (existing) return existing;

    // Everything from here on — the re-check, the plan-limit check, and
    // the paid AI call itself — runs under a per-uploadCvId lock, so two
    // requests racing for the SAME upload can never both fall through the
    // check above and both trigger AI/create a CV. The loser gets a fast,
    // clear 409 rather than silently doubling cost.
    const lockKey = `prefill-lock:${uploadCvId}`;
    const lockToken = await this.prefillLockService.acquire(lockKey, PREFILL_LOCK_TTL_MS);
    if (!lockToken) {
      throw new ConflictException(
        'This CV is already being prefilled. Please wait a moment and try again.',
      );
    }
    // §28: keeps the lock alive for as long as this operation genuinely
    // stays in progress — see this heartbeat's own constant doc comment
    // for why a fixed TTL alone isn't safe here (a slow OpenAI retry
    // sequence can legitimately outlast it).
    const stopHeartbeat = this.prefillLockService.startHeartbeat(
      lockKey,
      lockToken,
      PREFILL_LOCK_TTL_MS,
      PREFILL_LOCK_RENEW_INTERVAL_MS,
    );

    try {
      // Re-check now that we hold the lock: the request that WON an
      // earlier race for this same uploadCvId may have already finished
      // and released the lock between the cheap check above and this
      // point — reuse its result instead of calling AI a second time.
      const existingAfterLock = await this.cvRepo.findOne({
        where: { sourceUploadCvId: uploadCvId, userId: user.id },
      });
      if (existingAfterLock) return existingAfterLock;

      // Early, optimistic check — avoids wasting a paid AI call for the
      // common (non-racing) case of a user who's already visibly over
      // their plan's builder-CV limit. Not itself race-safe against a
      // DIFFERENT upload/creation path (see withBuilderCvQuotaLock below,
      // which re-checks authoritatively right before the actual insert).
      await this.checkBuilderCvLimit(user.id);

      // Diagnostic only — length, never content, so this is safe to log
      // (no PII). A very short length here is a strong signal that
      // parsedContent is placeholder/garbage text rather than a real CV body.
      this.logger.log(
        `Prefilling CV ${uploadCvId} from ${uploadCv.parsedContent.length} chars of parsed text`,
      );

      const extraction = await this.prefillService.extract(uploadCv.parsedContent);

      // §28: the AUTHORITATIVE quota check + insert, under a per-user
      // lock — closes the cross-upload/cross-path race the early check
      // above can't. See withBuilderCvQuotaLock's own doc comment.
      return await this.withBuilderCvQuotaLock(user.id, async () => {
        const cv = this.cvRepo.create({
          userId: user.id,
          title: uploadCv.title ?? uploadCv.fileName ?? 'Prefilled CV',
          source: 'prefill',
          parseStatus: 'done',
          isActive: true,
          content: extraction.content,
          sourceUploadCvId: uploadCvId,
          prefillExtractedAt: new Date(),
          prefillModel: extraction.modelUsed,
          prefillTokensUsed: extraction.tokensUsed,
          prefillVersion: extraction.version,
        });

        return this.cvRepo.save(cv);
      });
    } finally {
      stopHeartbeat();
      await this.prefillLockService.release(lockKey, lockToken);
    }
  }

  async generatePdfStream(
    clerkId: string,
    cvId: string,
  ): Promise<{ stream: import('stream').PassThrough; filename: string }> {
    const cv = await this.findOneForUser(clerkId, cvId);
    if (!cv.content) {
      throw new UnprocessableEntityException('This CV has no builder content to export.');
    }

    // Photo bytes are only ever loaded server-side, for Profile CVs that
    // actually have one — see CvPhotoService.getPhotoBytes's doc comment
    // for why a load failure here silently falls back to the no-photo
    // header rather than failing the whole PDF or touching the stored
    // photo association.
    const photo =
      cv.templateId === 'profile' && cv.photoObjectKey
        ? await this.cvPhotoService.getPhotoBytes(cv.photoObjectKey)
        : null;

    const stream = this.pdfService.generateStream(
      cv.content,
      cv.title ?? 'CV',
      cv.templateId,
      photo ?? undefined,
    );
    const safe = (cv.title ?? 'cv').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80);
    return { stream, filename: `${safe}.pdf` };
  }

  async createTailored(userId: string, content: CvContent, jobTitle?: string): Promise<CvEntity> {
    const title = jobTitle ? `Tailored CV — ${jobTitle}` : 'Tailored CV';
    const cv = this.cvRepo.create({
      userId,
      title,
      source: 'tailored',
      parseStatus: 'done',
      isActive: true,
      content,
    });
    return this.cvRepo.save(cv);
  }

  private async checkBuilderCvLimit(userId: string): Promise<void> {
    // DEV-ONLY quota bypass — see dev-quota-bypass.util.ts for the full
    // rationale. Never active outside NODE_ENV=development.
    if (isDevQuotaBypassActive()) return;

    const plan = await this.billingService.getUserPlan(userId);
    const limit = PLAN_LIMITS[plan].builderCvsTotal;
    if (limit === Infinity) return;

    const count = await this.cvRepo.count({
      where: { userId, source: In(['builder', 'prefill']) },
    });

    if (count >= limit) {
      throw new ForbiddenException(
        'Builder CV limit reached. Upgrade your plan to create more CVs.',
      );
    }
  }

  /**
   * §28: checkBuilderCvLimit() above answers "is this user under quota
   * right now" but is just a plain read — nothing stops TWO callers from
   * both reading "yes, under quota" before either has inserted its row.
   * That's exactly what could happen across createBuilder() and
   * prefillFromUpload() (or two prefillFromUpload() calls for two
   * DIFFERENT uploads — §27's per-uploadCvId lock doesn't cover this,
   * since it's keyed by upload, not by user): a Free-plan user
   * (builderCvsTotal: 1) at 0 CVs could fire two such calls close enough
   * together to end up with 2, silently bypassing the plan limit itself
   * (not a rare edge case for the FREE tier specifically — see
   * cv.service.spec.ts's "case 2" tests for real, demonstrated proof of
   * both the gap and the fix, not just the reasoning here).
   *
   * Fixes it by making the COUNT-CHECK-THEN-INSERT atomic per user, via a
   * short-lived, retried (not heartbeat-renewed — this only ever guards a
   * fast DB count+insert, never an AI call) PrefillLockService lock. Both
   * createBuilder() and prefillFromUpload() run their actual row creation
   * through `fn` here rather than inserting directly, so this is the ONE
   * place `PLAN_LIMITS.builderCvsTotal` is authoritatively enforced across
   * every builder-CV-creating path — checkBuilderCvLimit() itself is left
   * completely unchanged and keeps its existing callers/behavior for the
   * cheap, non-authoritative early checks (e.g. prefillFromUpload's own
   * pre-AI-call check, to avoid paying for extraction a user is already
   * over quota for).
   *
   * Skips the lock entirely for an Infinity (unlimited) plan — there is no
   * finite count to race against, so no Redis round trip is spent on
   * every Pro-plan CV creation.
   */
  private async withBuilderCvQuotaLock<T>(userId: string, fn: () => Promise<T>): Promise<T> {
    if (isDevQuotaBypassActive()) return fn();

    const plan = await this.billingService.getUserPlan(userId);
    const limit = PLAN_LIMITS[plan].builderCvsTotal;
    if (limit === Infinity) return fn();

    const lockKey = `builder-cv-quota-lock:${userId}`;
    let token: string | null = null;
    for (let attempt = 0; attempt < BUILDER_CV_QUOTA_LOCK_ACQUIRE_RETRIES; attempt++) {
      token = await this.prefillLockService.acquire(lockKey, BUILDER_CV_QUOTA_LOCK_TTL_MS);
      if (token) break;
      // The lock only ever guards a fast count+insert (typically single-
      // digit milliseconds), so a short, fixed retry delay — not a 409 —
      // is the right response to brief contention here, unlike §27's
      // per-upload AI-call lock, where the holder could legitimately be
      // busy for many seconds.
      await new Promise((resolve) =>
        setTimeout(resolve, BUILDER_CV_QUOTA_LOCK_ACQUIRE_RETRY_DELAY_MS),
      );
    }
    if (!token) {
      throw new ConflictException('Please try again in a moment.');
    }

    try {
      const count = await this.cvRepo.count({
        where: { userId, source: In(['builder', 'prefill']) },
      });
      if (count >= limit) {
        throw new ForbiddenException(
          'Builder CV limit reached. Upgrade your plan to create more CVs.',
        );
      }
      return await fn();
    } finally {
      await this.prefillLockService.release(lockKey, token);
    }
  }
}
