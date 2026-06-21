import type { MigrationInterface, QueryRunner } from 'typeorm';

export class InitialSchema1750000000000 implements MigrationInterface {
  name = 'InitialSchema1750000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. users
    await queryRunner.query(`
      CREATE TABLE "users" (
        "id"         UUID                     NOT NULL DEFAULT gen_random_uuid(),
        "clerk_id"   CHARACTER VARYING(255)   NOT NULL,
        "email"      CHARACTER VARYING(320)   NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "PK_users" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_users_clerk_id" UNIQUE ("clerk_id"),
        CONSTRAINT "UQ_users_email" UNIQUE ("email")
      )
    `);

    // 2. profiles (OneToOne with users)
    await queryRunner.query(`
      CREATE TABLE "profiles" (
        "id"             UUID                     NOT NULL DEFAULT gen_random_uuid(),
        "user_id"        UUID                     NOT NULL,
        "full_name"      CHARACTER VARYING(255),
        "university"     CHARACTER VARYING(255),
        "graduation_yr"  SMALLINT,
        "student_email"  CHARACTER VARYING(320),
        "created_at"     TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at"     TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_profiles" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_profiles_user_id" UNIQUE ("user_id"),
        CONSTRAINT "FK_profiles_users" FOREIGN KEY ("user_id")
          REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);

    // 3. subscriptions (OneToOne with users)
    await queryRunner.query(`
      CREATE TABLE "subscriptions" (
        "id"                       UUID                     NOT NULL DEFAULT gen_random_uuid(),
        "user_id"                  UUID                     NOT NULL,
        "stripe_customer_id"       CHARACTER VARYING(255)   NOT NULL,
        "stripe_subscription_id"   CHARACTER VARYING(255),
        "plan"                     CHARACTER VARYING(20)    NOT NULL DEFAULT 'free',
        "status"                   CHARACTER VARYING(30)    NOT NULL DEFAULT 'active',
        "current_period_start"     TIMESTAMP WITH TIME ZONE,
        "current_period_end"       TIMESTAMP WITH TIME ZONE,
        "cancel_at_period_end"     BOOLEAN                  NOT NULL DEFAULT FALSE,
        "created_at"               TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at"               TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_subscriptions" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_subscriptions_user_id" UNIQUE ("user_id"),
        CONSTRAINT "UQ_subscriptions_stripe_customer_id" UNIQUE ("stripe_customer_id"),
        CONSTRAINT "UQ_subscriptions_stripe_subscription_id" UNIQUE ("stripe_subscription_id"),
        CONSTRAINT "FK_subscriptions_users" FOREIGN KEY ("user_id")
          REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);

    // 4. cvs
    await queryRunner.query(`
      CREATE TABLE "cvs" (
        "id"              UUID                     NOT NULL DEFAULT gen_random_uuid(),
        "user_id"         UUID                     NOT NULL,
        "file_name"       CHARACTER VARYING(255)   NOT NULL,
        "r2_object_key"   CHARACTER VARYING(512)   NOT NULL,
        "file_size_bytes" INTEGER                  NOT NULL,
        "mime_type"       CHARACTER VARYING(100)   NOT NULL,
        "parsed_content"  TEXT,
        "parse_status"    CHARACTER VARYING(20)    NOT NULL DEFAULT 'pending',
        "is_active"       BOOLEAN                  NOT NULL DEFAULT TRUE,
        "created_at"      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at"      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "deleted_at"      TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "PK_cvs" PRIMARY KEY ("id"),
        CONSTRAINT "FK_cvs_users" FOREIGN KEY ("user_id")
          REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_cvs_user_id" ON "cvs" ("user_id")`);

    // 5. analyses
    await queryRunner.query(`
      CREATE TABLE "analyses" (
        "id"               UUID                     NOT NULL DEFAULT gen_random_uuid(),
        "user_id"          UUID                     NOT NULL,
        "cv_id"            UUID                     NOT NULL,
        "job_title"        CHARACTER VARYING(255),
        "company_name"     CHARACTER VARYING(255),
        "job_description"  TEXT                     NOT NULL,
        "match_score"      SMALLINT,
        "suggestions"      JSONB,
        "model_used"       CHARACTER VARYING(100),
        "tokens_used"      INTEGER,
        "status"           CHARACTER VARYING(20)    NOT NULL DEFAULT 'pending',
        "created_at"       TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "completed_at"     TIMESTAMP WITH TIME ZONE,
        "deleted_at"       TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "PK_analyses" PRIMARY KEY ("id"),
        CONSTRAINT "FK_analyses_users" FOREIGN KEY ("user_id")
          REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_analyses_cvs" FOREIGN KEY ("cv_id")
          REFERENCES "cvs"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_analyses_user_id" ON "analyses" ("user_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_analyses_cv_id" ON "analyses" ("cv_id")`);

    // 6. ats_reports (OneToOne with analyses)
    await queryRunner.query(`
      CREATE TABLE "ats_reports" (
        "id"               UUID                     NOT NULL DEFAULT gen_random_uuid(),
        "analysis_id"      UUID                     NOT NULL,
        "keyword_hits"     JSONB,
        "missing_keywords" JSONB,
        "format_warnings"  JSONB,
        "ats_score"        SMALLINT,
        "created_at"       TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_ats_reports" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_ats_reports_analysis_id" UNIQUE ("analysis_id"),
        CONSTRAINT "FK_ats_reports_analyses" FOREIGN KEY ("analysis_id")
          REFERENCES "analyses"("id") ON DELETE CASCADE
      )
    `);

    // 7. cover_letters
    await queryRunner.query(`
      CREATE TABLE "cover_letters" (
        "id"             UUID                     NOT NULL DEFAULT gen_random_uuid(),
        "user_id"        UUID                     NOT NULL,
        "cv_id"          UUID                     NOT NULL,
        "analysis_id"    UUID,
        "job_title"      CHARACTER VARYING(255),
        "company_name"   CHARACTER VARYING(255),
        "content"        TEXT                     NOT NULL,
        "r2_object_key"  CHARACTER VARYING(512),
        "model_used"     CHARACTER VARYING(100),
        "tokens_used"    INTEGER,
        "status"         CHARACTER VARYING(20)    NOT NULL DEFAULT 'draft',
        "created_at"     TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at"     TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "deleted_at"     TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "PK_cover_letters" PRIMARY KEY ("id"),
        CONSTRAINT "FK_cover_letters_users" FOREIGN KEY ("user_id")
          REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_cover_letters_cvs" FOREIGN KEY ("cv_id")
          REFERENCES "cvs"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_cover_letters_analyses" FOREIGN KEY ("analysis_id")
          REFERENCES "analyses"("id") ON DELETE SET NULL
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_cover_letters_user_id" ON "cover_letters" ("user_id")`,
    );

    // 8. payments
    await queryRunner.query(`
      CREATE TABLE "payments" (
        "id"                UUID                     NOT NULL DEFAULT gen_random_uuid(),
        "user_id"           UUID                     NOT NULL,
        "stripe_payment_id" CHARACTER VARYING(255)   NOT NULL,
        "amount_pence"      INTEGER                  NOT NULL,
        "currency"          CHARACTER VARYING(3)     NOT NULL DEFAULT 'gbp',
        "status"            CHARACTER VARYING(30)    NOT NULL,
        "created_at"        TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_payments" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_payments_stripe_payment_id" UNIQUE ("stripe_payment_id"),
        CONSTRAINT "FK_payments_users" FOREIGN KEY ("user_id")
          REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);

    // 9. audit_logs — append-only; no FK on user_id (user may be deleted but logs must persist)
    await queryRunner.query(`
      CREATE TABLE "audit_logs" (
        "id"          UUID                     NOT NULL DEFAULT gen_random_uuid(),
        "user_id"     UUID,
        "action"      CHARACTER VARYING(100)   NOT NULL,
        "entity_type" CHARACTER VARYING(50),
        "entity_id"   UUID,
        "metadata"    JSONB,
        "ip_address"  INET,
        "created_at"  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_audit_logs" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_audit_logs_user_id" ON "audit_logs" ("user_id")`);
    await queryRunner.query(
      `CREATE INDEX "IDX_audit_logs_entity" ON "audit_logs" ("entity_type", "entity_id")`,
    );

    // 10. notifications
    await queryRunner.query(`
      CREATE TABLE "notifications" (
        "id"         UUID                     NOT NULL DEFAULT gen_random_uuid(),
        "user_id"    UUID                     NOT NULL,
        "type"       CHARACTER VARYING(100)   NOT NULL,
        "payload"    JSONB,
        "sent_at"    TIMESTAMP WITH TIME ZONE,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_notifications" PRIMARY KEY ("id"),
        CONSTRAINT "FK_notifications_users" FOREIGN KEY ("user_id")
          REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_notifications_user_id" ON "notifications" ("user_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "notifications"`);
    await queryRunner.query(`DROP TABLE "audit_logs"`);
    await queryRunner.query(`DROP TABLE "payments"`);
    await queryRunner.query(`DROP TABLE "cover_letters"`);
    await queryRunner.query(`DROP TABLE "ats_reports"`);
    await queryRunner.query(`DROP TABLE "analyses"`);
    await queryRunner.query(`DROP TABLE "cvs"`);
    await queryRunner.query(`DROP TABLE "subscriptions"`);
    await queryRunner.query(`DROP TABLE "profiles"`);
    await queryRunner.query(`DROP TABLE "users"`);
  }
}
