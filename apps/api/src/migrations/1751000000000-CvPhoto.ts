import type { MigrationInterface, QueryRunner } from 'typeorm';

// Profile template (Phase 7) — the optional profile photo's R2 object key
// lives on its own nullable column, deliberately never inside the
// `content` JSONB blob. See CvEntity.photoObjectKey's doc comment for the
// full reasoning (mirrors template_id: presentation metadata that must
// never be affected by, or affect, a text-only content autosave).
// NULL DEFAULT means every existing CV row is safely backfilled to "no
// photo" by Postgres itself, with no separate data migration step.
export class CvPhoto1751000000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "cvs"
        ADD COLUMN "photo_object_key" VARCHAR(512) NULL
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "cvs"
        DROP COLUMN "photo_object_key"
    `);
  }
}
