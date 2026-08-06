import type { MigrationInterface, QueryRunner } from 'typeorm';

export class TailoringTable1750500000000 implements MigrationInterface {
  name = 'TailoringTable1750500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "tailorings" (
        "id"             UUID         NOT NULL DEFAULT gen_random_uuid(),
        "user_id"        UUID         NOT NULL,
        "master_cv_id"   UUID         NOT NULL,
        "tailored_cv_id" UUID,
        "job_title"      VARCHAR(255),
        "company_name"   VARCHAR(255),
        "job_description" TEXT        NOT NULL,
        "suggestions"    JSONB,
        "decisions"      JSONB,
        "model_used"     VARCHAR(100),
        "tokens_used"    INTEGER,
        "status"         VARCHAR(20)  NOT NULL DEFAULT 'pending',
        "created_at"     TIMESTAMPTZ  NOT NULL DEFAULT now(),
        "completed_at"   TIMESTAMPTZ,
        "deleted_at"     TIMESTAMPTZ,
        CONSTRAINT "PK_tailorings" PRIMARY KEY ("id"),
        CONSTRAINT "FK_tailorings_users"      FOREIGN KEY ("user_id")        REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_tailorings_master_cv"  FOREIGN KEY ("master_cv_id")   REFERENCES "cvs"("id"),
        CONSTRAINT "FK_tailorings_tailored_cv" FOREIGN KEY ("tailored_cv_id") REFERENCES "cvs"("id")
      )
    `);

    await queryRunner.query(`CREATE INDEX "IDX_tailorings_user_id"    ON "tailorings" ("user_id")`);
    await queryRunner.query(
      `CREATE INDEX "IDX_tailorings_created_at" ON "tailorings" ("created_at")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_tailorings_created_at"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_tailorings_user_id"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "tailorings"`);
  }
}
