import type { MigrationInterface, QueryRunner } from 'typeorm';

// RABBIT_NOTEBOOK.md §57 — production QA found the UI shows the same
// "edit fields and retry" message for every failed generation, even though
// real production failures were confirmed (via Railway logs) to be
// entirely internal possession-claim grounding rejections — nothing wrong
// with any field the user typed. Without persisting WHY a generation
// failed, the frontend has no way to tell a grounding rejection apart from
// a genuine provider error, so it could only ever show one generic,
// sometimes-misleading message. Nullable and free-text (not a DB enum),
// same convention as every other cover_letters column: no existing row has
// a value, and a NULL here must remain a valid, renderable state (older
// failed rows simply show the generic message, same as before this
// migration).
export class CoverLetterFailureReason1751100000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "cover_letters"
        ADD COLUMN "failure_reason" VARCHAR(30)
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "cover_letters"
        DROP COLUMN "failure_reason"
    `);
  }
}
