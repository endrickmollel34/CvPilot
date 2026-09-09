import type { MigrationInterface, QueryRunner } from 'typeorm';

// Cover Letter V2 — the workspace/editor now needs to redisplay and let the
// candidate revise the exact job/recipient details a letter was generated
// from (for "Regenerate", and so reopening a letter later shows the same
// live preview it was created with), so these become real persisted
// columns instead of transient submit-time-only values. All four are
// deliberately nullable: existing rows predate this migration and have no
// values for any of them (regenerating an old letter is still possible —
// the workspace lets the user fill in a job description before hitting
// Regenerate — but the field legitimately starts empty), and
// recipientName/recipientTitle/companyAddress are optional even for new
// letters (not every application has a known hiring-manager name or a
// postal address to include).
export class CoverLetterV2Fields1750700000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "cover_letters"
        ADD COLUMN "job_description" TEXT,
        ADD COLUMN "recipient_name" VARCHAR(255),
        ADD COLUMN "recipient_title" VARCHAR(255),
        ADD COLUMN "company_address" TEXT
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "cover_letters"
        DROP COLUMN "job_description",
        DROP COLUMN "recipient_name",
        DROP COLUMN "recipient_title",
        DROP COLUMN "company_address"
    `);
  }
}
