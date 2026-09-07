import type { MigrationInterface, QueryRunner } from 'typeorm';

// CV Template Foundation, Phase 1 — templateId is presentation metadata,
// deliberately a plain column on `cvs`, never a field inside the
// `content` JSONB blob. Tailoring/Analysis/Cover Letter only ever read
// `content`/`parsed_content` (see the Template Foundation decision
// report) — keeping templateId out of `content` guarantees they can never
// be affected by template selection, now or as more templates are added.
// NOT NULL DEFAULT 'classic' means every existing CV row is safely
// backfilled to Classic by Postgres itself, with no separate data migration
// step and no CV ever left without a resolvable template.
export class CvTemplateId1750600000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "cvs"
        ADD COLUMN "template_id" VARCHAR(50) NOT NULL DEFAULT 'classic'
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "cvs"
        DROP COLUMN "template_id"
    `);
  }
}
