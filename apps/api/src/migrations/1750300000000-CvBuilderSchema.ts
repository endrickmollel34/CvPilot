import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CvBuilderSchema1750300000000 implements MigrationInterface {
  name = 'CvBuilderSchema1750300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Make file-specific columns nullable — builder CVs have no R2 upload
    await queryRunner.query(`
      ALTER TABLE "cvs"
        ALTER COLUMN "r2_object_key" DROP NOT NULL,
        ALTER COLUMN "file_name"     DROP NOT NULL,
        ALTER COLUMN "file_size_bytes" DROP NOT NULL,
        ALTER COLUMN "mime_type"     DROP NOT NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "cvs"
        ADD COLUMN "title"   CHARACTER VARYING(255),
        ADD COLUMN "source"  CHARACTER VARYING(20) NOT NULL DEFAULT 'upload',
        ADD COLUMN "content" JSONB
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "cvs"
        DROP COLUMN "content",
        DROP COLUMN "source",
        DROP COLUMN "title"
    `);

    // Restoring NOT NULL is only safe on a clean database with no builder CV rows.
    await queryRunner.query(`
      ALTER TABLE "cvs"
        ALTER COLUMN "mime_type"       SET NOT NULL,
        ALTER COLUMN "file_size_bytes" SET NOT NULL,
        ALTER COLUMN "file_name"       SET NOT NULL,
        ALTER COLUMN "r2_object_key"   SET NOT NULL
    `);
  }
}
