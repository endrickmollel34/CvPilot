import type { MigrationInterface, QueryRunner } from 'typeorm';

export class ProviderNeutralBilling1750100000000 implements MigrationInterface {
  name = 'ProviderNeutralBilling1750100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── subscriptions ────────────────────────────────────────────────────────

    // Rename Stripe-specific columns to provider-neutral names
    await queryRunner.query(
      `ALTER TABLE "subscriptions" RENAME COLUMN "stripe_customer_id" TO "provider_customer_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "subscriptions" RENAME COLUMN "stripe_subscription_id" TO "provider_subscription_id"`,
    );

    // Add provider-neutral columns
    await queryRunner.query(`
      ALTER TABLE "subscriptions"
        ADD COLUMN "provider"          CHARACTER VARYING(30)  NOT NULL DEFAULT 'STRIPE',
        ADD COLUMN "payment_method"    CHARACTER VARYING(30),
        ADD COLUMN "billing_cycle"     CHARACTER VARYING(20)  NOT NULL DEFAULT 'recurring',
        ADD COLUMN "provider_metadata" JSONB
    `);

    // ── payments ─────────────────────────────────────────────────────────────

    // Rename Stripe-specific columns
    await queryRunner.query(
      `ALTER TABLE "payments" RENAME COLUMN "stripe_payment_id" TO "provider_payment_id"`,
    );
    await queryRunner.query(`ALTER TABLE "payments" RENAME COLUMN "amount_pence" TO "amount"`);

    // Add provider-neutral columns and updated_at
    await queryRunner.query(`
      ALTER TABLE "payments"
        ADD COLUMN "provider"                       CHARACTER VARYING(30)   NOT NULL DEFAULT 'STRIPE',
        ADD COLUMN "provider_transaction_reference" CHARACTER VARYING(255),
        ADD COLUMN "payment_method"                 CHARACTER VARYING(30),
        ADD COLUMN "provider_metadata"              JSONB,
        ADD COLUMN "updated_at"                     TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
    `);

    // Uppercase existing currency values to match new domain convention
    await queryRunner.query(`UPDATE "payments" SET "currency" = UPPER("currency")`);

    // Change the column default to uppercase
    await queryRunner.query(`ALTER TABLE "payments" ALTER COLUMN "currency" SET DEFAULT 'GBP'`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // ── payments ─────────────────────────────────────────────────────────────

    await queryRunner.query(`ALTER TABLE "payments" ALTER COLUMN "currency" SET DEFAULT 'gbp'`);
    await queryRunner.query(`UPDATE "payments" SET "currency" = LOWER("currency")`);

    await queryRunner.query(`
      ALTER TABLE "payments"
        DROP COLUMN "updated_at",
        DROP COLUMN "provider_metadata",
        DROP COLUMN "payment_method",
        DROP COLUMN "provider_transaction_reference",
        DROP COLUMN "provider"
    `);

    await queryRunner.query(`ALTER TABLE "payments" RENAME COLUMN "amount" TO "amount_pence"`);
    await queryRunner.query(
      `ALTER TABLE "payments" RENAME COLUMN "provider_payment_id" TO "stripe_payment_id"`,
    );

    // ── subscriptions ────────────────────────────────────────────────────────

    await queryRunner.query(`
      ALTER TABLE "subscriptions"
        DROP COLUMN "provider_metadata",
        DROP COLUMN "billing_cycle",
        DROP COLUMN "payment_method",
        DROP COLUMN "provider"
    `);

    await queryRunner.query(
      `ALTER TABLE "subscriptions" RENAME COLUMN "provider_subscription_id" TO "stripe_subscription_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "subscriptions" RENAME COLUMN "provider_customer_id" TO "stripe_customer_id"`,
    );
  }
}
