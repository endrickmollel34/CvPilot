import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CvPrefillFields1750400000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "cvs"
        ADD COLUMN "source_upload_cv_id" UUID NULL,
        ADD COLUMN "prefill_extracted_at" TIMESTAMPTZ NULL,
        ADD COLUMN "prefill_model" VARCHAR(100) NULL,
        ADD COLUMN "prefill_tokens_used" INTEGER NULL,
        ADD COLUMN "prefill_version" INTEGER NULL
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "cvs"
        DROP COLUMN "source_upload_cv_id",
        DROP COLUMN "prefill_extracted_at",
        DROP COLUMN "prefill_model",
        DROP COLUMN "prefill_tokens_used",
        DROP COLUMN "prefill_version"
    `);
  }
}
