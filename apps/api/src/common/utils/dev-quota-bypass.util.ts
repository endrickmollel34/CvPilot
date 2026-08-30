/**
 * DEVELOPMENT-ONLY plan quota bypass.
 *
 * Why this exists: local development reuses a handful of Clerk test
 * accounts, which quickly exhaust the Free plan's monthly limits
 * (`PLAN_LIMITS` in packages/shared/src/types/billing.types.ts — CV
 * analyses, cover letters, builder CVs, tailorings). Once exhausted, manual
 * end-to-end testing of anything past the paywall is blocked without
 * either wiring up a real Stripe subscription locally or hand-editing rows
 * in the database.
 *
 * Gating: strictly `NODE_ENV === 'development'`.
 *  - Local `npm run dev` (apps/api/.env sets NODE_ENV=development) → bypass ON.
 *  - `npm test` / `npm run test:e2e` → Jest forces NODE_ENV='test'      → bypass OFF.
 *  - Railway/Vercel production and staging deploys set NODE_ENV to
 *    'production' (never 'development')                                → bypass OFF.
 *
 * This only ever short-circuits the *quota count* check inside an
 * already-authenticated request (Clerk JWT is still validated as normal by
 * `ClerkGuard`) — it does not touch plan resolution, Stripe webhook
 * handling, or any other part of the billing/provider architecture.
 *
 * Do NOT:
 *  - widen the condition to also match 'test' (that would silently defeat
 *    the unit tests that assert quota enforcement), or
 *  - key this off a specific Clerk user ID (that would bake a developer's
 *    personal identity into the codebase and wouldn't help teammates).
 */
export function isDevQuotaBypassActive(): boolean {
  return process.env['NODE_ENV'] === 'development';
}
