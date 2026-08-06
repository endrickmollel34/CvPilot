import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CoverLetterEnhancements1750200000000 implements MigrationInterface {
  name = 'CoverLetterEnhancements1750200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "cover_letters"
        ADD COLUMN "tone"         CHARACTER VARYING(30),
        ADD COLUMN "generated_at" TIMESTAMP WITH TIME ZONE
    `);

    // Update default status from 'draft' to 'queued' for new rows.
    // Existing rows retain their current status value.
    await queryRunner.query(
      `ALTER TABLE "cover_letters" ALTER COLUMN "status" SET DEFAULT 'queued'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "cover_letters" ALTER COLUMN "status" SET DEFAULT 'draft'`,
    );

    await queryRunner.query(`
      ALTER TABLE "cover_letters"
        DROP COLUMN "generated_at",
        DROP COLUMN "tone"
    `);
  }
}
