import type { MigrationInterface, QueryRunner } from 'typeorm';

// Cover Letter V2.1 — supports a proper two-sided business-letter layout
// (sender block upper-right, recipient block left). Free-text and
// deliberately nullable, same convention as company_address (see
// CoverLetterV2Fields1750700000000): no existing row has a value, it is
// never required to generate/save/regenerate/preview/download a letter,
// and it is never inferred from the linked CV — the CV's own data model
// has no full postal address field (only a short `location` string,
// already used on its own), so there is nothing safe to backfill from.
export class CoverLetterSenderAddress1750800000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "cover_letters"
        ADD COLUMN "sender_address" TEXT
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "cover_letters"
        DROP COLUMN "sender_address"
    `);
  }
}
