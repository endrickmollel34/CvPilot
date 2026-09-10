import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Quota-refund fix, transition step: BillingService/TailoringService now
 * compute monthly usage from durable `audit_logs` rows (action
 * analysis.generated / cover_letter.generated / tailoring.generated) instead
 * of live-counting analyses/cover_letters/tailorings rows — see
 * usage-actions.ts. AuditService.log()/logTransactional() had zero callers
 * before that change, so every Analysis/CoverLetter/Tailoring created BEFORE
 * this deploy has no corresponding audit_logs row. Deployed as-is, every
 * user's already-consumed usage for the current month would silently read
 * back as 0 the moment this ships — not a refund exploit, but an accidental
 * full quota reset for the entire existing user base.
 *
 * This migration backfills exactly the audit_logs rows that would already
 * exist had logging been active from day one, so post-deploy usage reads
 * back identical to what canPerformAction()/getUsageSummary() would have
 * reported the moment before deploy:
 *
 *   - one row per existing content row whose status is a genuinely
 *     successful, completed-generation status — see the per-table status
 *     predicates below, derived from each entity's actual status enum and
 *     the exact statuses each service sets on a real success path (not a
 *     blanket "!= failed", which would wrongly also backfill pending/
 *     queued/processing rows that never actually finished generating) —
 *     and whose deleted_at is NULL (an entity with @DeleteDateColumn is
 *     excluded from a plain repo.count() by TypeORM unless withDeleted is
 *     passed — the old code never passed it, so this matches old behavior
 *     exactly, even though in practice CV/Analysis/CoverLetter/Tailoring
 *     deletion in this app is always a genuine hard delete and deleted_at
 *     is never actually set)
 *   - entity_id = the content row's own id, entity_type/action = the exact
 *     same strings the live application code uses (see usage-actions.ts) —
 *     required for COUNT(DISTINCT entity_id) at read time to recognise these
 *     rows as the same "kind" of event the app logs going forward
 *   - user_id = the content row's own user_id (already the internal user
 *     UUID, matching audit_logs.user_id's own meaning)
 *   - created_at = the content row's own created_at, not now() — so a
 *     backfilled event lands in the correct historical month, not the
 *     migration's run date
 *   - metadata = {"backfill": true} — purely informational, lets a backfilled
 *     row be told apart from one the running application logged; read
 *     nowhere by any query, so it cannot affect counting
 *
 * Per-table status predicates (verified against each entity's actual status
 * type and the real code paths that set each value, not guessed):
 *
 *   - analyses.status: 'pending' | 'processing' | 'done' | 'failed'
 *     (analysis.entity.ts's AnalysisStatus). 'done' is the only terminal
 *     success state — set once inside AnalysisService.process()'s success
 *     transaction, after the AI call and grounding succeed. 'pending' and
 *     'processing' are non-terminal (either still in flight or abandoned/
 *     crashed mid-job — never a completed generation) and must NOT count.
 *     → WHERE status = 'done'
 *
 *   - cover_letters.status: 'queued' | 'processing' | 'generated' | 'failed'
 *     | 'downloaded' (cover-letter.entity.ts's CoverLetterStatus).
 *     'generated' is set on success in CoverLetterService.process(). Once a
 *     letter has been downloaded, getDownloadUrl() advances it further to
 *     'downloaded' (cover-letter.service.ts) — reachable only from an
 *     already-'generated' letter (see its own "not ready for download"
 *     guard checking exactly these two statuses), so it is just as
 *     genuinely successful, one step further along, not a distinct outcome.
 *     'queued'/'processing' are non-terminal and must NOT count.
 *     → WHERE status IN ('generated', 'downloaded')
 *
 *   - tailorings.status: 'pending' | 'processing' | 'done' | 'failed' |
 *     'applied' (tailoring.types.ts's TailoringStatus, in @cvpilot/shared).
 *     'done' is set on success in TailoringService.runTailoring(). 'applied'
 *     is set by apply() only once decisions have been applied to produce a
 *     tailored CV — reachable only from an already-'done' tailoring (apply()
 *     throws UnprocessableEntityException otherwise), so it is the same
 *     underlying successful generation, one step further along.
 *     'pending'/'processing' are non-terminal and must NOT count.
 *     → WHERE status IN ('done', 'applied')
 *
 * One content row → one audit_logs row, regardless of anything else about
 * that row's history. This preserves the "Cover Letter regenerate() re-uses
 * the same id" semantics automatically: only one cover_letters row ever
 * existed for a given id, so only one backfilled event exists for it,
 * exactly matching the COUNT(DISTINCT entity_id) the live code already
 * relies on. Already-hard-deleted historical rows are NOT reconstructed —
 * there is nothing left in the DB to backfill from (no soft-delete tombstone
 * exists for any of these three tables — see each entity's own deletion
 * code), so a generation from before this deploy that was ALSO deleted
 * before this deploy contributes 0 either way, matching what canPerformAction
 * would have already been computing the moment before this migration runs
 * (i.e. it already did not count a deleted row).
 *
 * Idempotency: TypeORM's migration runner only ever executes a given
 * migration's up() once per database (tracked in the `migrations` table,
 * the same guarantee every other migration in this codebase already relies
 * on). The NOT EXISTS guard on each INSERT is additional, defense-in-depth
 * protection against a duplicate run outside that normal path — re-running
 * this migration's up() a second time inserts zero further rows. down()
 * reverses by the backfill metadata marker (not by re-deriving the status
 * predicate), so it stays correct regardless of which statuses up() targets.
 */
export class BackfillUsageAuditEvents1750900000000 implements MigrationInterface {
  name = 'BackfillUsageAuditEvents1750900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO "audit_logs" ("user_id", "action", "entity_type", "entity_id", "metadata", "created_at")
      SELECT a."user_id", 'analysis.generated', 'analysis', a."id", '{"backfill": true}'::jsonb, a."created_at"
      FROM "analyses" a
      WHERE a."status" = 'done'
        AND a."deleted_at" IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM "audit_logs" al
          WHERE al."entity_type" = 'analysis'
            AND al."entity_id" = a."id"
            AND al."action" = 'analysis.generated'
        )
    `);

    await queryRunner.query(`
      INSERT INTO "audit_logs" ("user_id", "action", "entity_type", "entity_id", "metadata", "created_at")
      SELECT cl."user_id", 'cover_letter.generated', 'cover_letter', cl."id", '{"backfill": true}'::jsonb, cl."created_at"
      FROM "cover_letters" cl
      WHERE cl."status" IN ('generated', 'downloaded')
        AND cl."deleted_at" IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM "audit_logs" al
          WHERE al."entity_type" = 'cover_letter'
            AND al."entity_id" = cl."id"
            AND al."action" = 'cover_letter.generated'
        )
    `);

    await queryRunner.query(`
      INSERT INTO "audit_logs" ("user_id", "action", "entity_type", "entity_id", "metadata", "created_at")
      SELECT t."user_id", 'tailoring.generated', 'tailoring', t."id", '{"backfill": true}'::jsonb, t."created_at"
      FROM "tailorings" t
      WHERE t."status" IN ('done', 'applied')
        AND t."deleted_at" IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM "audit_logs" al
          WHERE al."entity_type" = 'tailoring'
            AND al."entity_id" = t."id"
            AND al."action" = 'tailoring.generated'
        )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM "audit_logs"
      WHERE "metadata" @> '{"backfill": true}'::jsonb
        AND "action" IN ('analysis.generated', 'cover_letter.generated', 'tailoring.generated')
    `);
  }
}
