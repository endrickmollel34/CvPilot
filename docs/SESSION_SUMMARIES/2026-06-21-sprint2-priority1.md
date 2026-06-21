# Sprint 2 Priority 1 Session Summary — 2026-06-21

## What Was Completed

Priority 1 of Sprint 2 (Core Data Layer) is complete and fully validated:

- All 10 TypeORM entities reviewed and corrected
- TypeORM DataSource created for CLI migration commands
- Initial schema migration written covering all 10 tables
- `UserService.findOrCreateByClerkId()` implemented with atomic upsert
- Clerk webhook verification implemented with Svix signature checking
- Full monorepo typecheck and API build passing clean

---

## Files Changed

### New Files

| File                                                     | Purpose                                                    |
| -------------------------------------------------------- | ---------------------------------------------------------- |
| `apps/api/src/data-source.ts`                            | TypeORM DataSource for `migration:run/generate/revert` CLI |
| `apps/api/src/migrations/1750000000000-InitialSchema.ts` | Creates all 10 tables in FK-safe order                     |

### Modified Entities

| File                                           | Change                                                          |
| ---------------------------------------------- | --------------------------------------------------------------- |
| `apps/api/src/entities/cv.entity.ts`           | Added `@UpdateDateColumn updatedAt`                             |
| `apps/api/src/entities/analysis.entity.ts`     | Added `@DeleteDateColumn deletedAt`                             |
| `apps/api/src/entities/cover-letter.entity.ts` | Added `@ManyToOne` relations to `CvEntity` and `AnalysisEntity` |
| `apps/api/src/entities/notification.entity.ts` | Added `@ManyToOne` relation to `UserEntity`                     |

### Modified Services / Modules

| File                                              | Change                                                                                |
| ------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `apps/api/src/modules/user/user.service.ts`       | `upsertFromClerk` → `findOrCreateByClerkId` using `userRepo.upsert()`                 |
| `apps/api/src/modules/auth/auth.service.ts`       | Full Svix verification + `user.created/updated/deleted` routing                       |
| `apps/api/src/modules/auth/auth.controller.ts`    | Switched to `RawBodyRequest` for Svix signature verification                          |
| `apps/api/src/modules/auth/auth.module.ts`        | Added `UserModule` import for `UserService` DI                                        |
| `apps/api/src/modules/auth/guards/clerk.guard.ts` | Replaced `createClerkClient` with standalone `verifyToken`; correct try/catch pattern |
| `apps/api/src/main.ts`                            | Added `{ rawBody: true }` to `NestFactory.create()`                                   |
| `apps/api/package.json`                           | Added `svix ^1.45.0`; added `migration:create` script                                 |

### TypeScript / Monorepo Config Fixes

| File                                     | Change                                                                |
| ---------------------------------------- | --------------------------------------------------------------------- |
| `packages/typescript-config/nestjs.json` | Removed `include`, `exclude`, `outDir`, `rootDir` (consumer-specific) |
| `packages/typescript-config/nextjs.json` | Removed `include`, `exclude`, `paths` (consumer-specific)             |
| `apps/api/tsconfig.json`                 | Added `outDir`, `rootDir`, `include`, `exclude` (moved from preset)   |
| `package.json` (root)                    | Added `"packageManager": "npm@11.0.0"` required by Turborepo v2       |

---

## Decisions Made

| Decision                                             | Rationale                                                                                                                                                                      |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `userRepo.upsert()` over check-then-insert           | Atomic `INSERT ... ON CONFLICT DO UPDATE` eliminates TOCTOU race on concurrent Clerk webhook retries                                                                           |
| `findOrCreateByClerkId` updates email on conflict    | `user.updated` events (e.g. email change in Clerk) are handled by the same upsert — no separate update path needed                                                             |
| Svix raw body in controller                          | Signature verification requires the exact bytes as received; `@Body()` (parsed JSON) would always fail verification                                                            |
| `{ rawBody: true }` on app level                     | Required for both Clerk and Stripe webhook handlers; single flag covers both                                                                                                   |
| No FK on `audit_logs.user_id`                        | Audit records must outlive their user; a FK with `ON DELETE CASCADE` would destroy the audit trail on GDPR deletion                                                            |
| `ON DELETE CASCADE` for most FKs                     | Child data (CVs, analyses, cover letters) is meaningless without the parent user; cascade keeps DB consistent                                                                  |
| `ON DELETE SET NULL` for `cover_letters.analysis_id` | Cover letters can exist independently of an analysis; nulling the FK preserves the letter if the analysis is deleted                                                           |
| Shared tsconfig presets: compilerOptions only        | TypeScript resolves `include/exclude/outDir/rootDir` relative to the file that defines them — putting them in a shared preset points them at the wrong directory               |
| Standalone `verifyToken` not `ClerkClient`           | `ClerkClient` returned by `createClerkClient()` never had a `verifyToken` method; `verifyToken` is a top-level export that throws on failure and returns `JwtPayload` directly |

---

## Issues Encountered

### TS18003 — No inputs found in config file

`packages/typescript-config/nestjs.json` contained `"include": ["src/**/*"]`. When `apps/api/tsconfig.json` extended it, TypeScript resolved the path relative to the preset file's location (`packages/typescript-config/src/`), not the API app. That directory doesn't exist → TS18003.

**Fix:** Shared preset files contain only `compilerOptions`. All of `include`, `exclude`, `outDir`, `rootDir` moved to each consumer's own tsconfig.

### Turborepo workspace resolution failure

Turborepo v2 requires `"packageManager"` in the root `package.json` to determine workspace layout strategy (npm vs pnpm vs yarn). Without it, Turbo cannot resolve any workspace.

**Fix:** Added `"packageManager": "npm@11.0.0"` to root `package.json`.

### TS2339 — `verifyToken` does not exist on type `ClerkClient`

`createClerkClient()` returns `ClerkClient` which is `ApiClient & ReturnType<typeof createAuthenticateRequest>` — it has REST API helpers, not a token verifier. `verifyToken` is a standalone export from `@clerk/backend`.

**Fix:** Removed `createClerkClient` from the guard entirely. Import and call standalone `verifyToken(token, { secretKey })`.

### TS18046 — `result.data` is of type `unknown`

The internal `verify.d.ts` uses a discriminated union `{ data, errors }` but the public index export signature is `Promise<NonNullable<JwtPayload | undefined>>` — it throws on failure. Additionally, `JwtPayload` carries an index signature `[propName: string]: unknown`, making any non-named property access (like `.data`) resolve to `unknown`.

**Fix:** `try/catch` pattern. `payload.sub` is a named property (`sub: string`) on `JWTPayloadBase` and resolves to `string` without any cast.

---

## Migration Notes

Before the migration can be run against a database:

```bash
# Build the API (migration CLI reads dist/)
cd apps/api
npm run build

# Set DATABASE_URL in apps/api/.env, then:
npm run migration:run
```

The migration creates tables in this FK-safe order:
`users` → `profiles` → `subscriptions` → `cvs` → `analyses` → `ats_reports` → `cover_letters` → `payments` → `audit_logs` → `notifications`

---

## Next Steps for Sprint 2 Priority 2 — CV Upload Flow

- [ ] Wire `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner` into `CvService.generateUploadUrl()`
- [ ] Resolve `clerkId → userId` in `CvService` using `UserService.findByClerkId()`
- [ ] Configure Cloudflare R2 credentials in environment
- [ ] Implement `cv-parsing` BullMQ worker (PDF/DOCX text extraction via `pdf-parse` / `mammoth`)
- [ ] Wire `BillingService.canPerformAction()` into CV upload limit check
- [ ] Add integration test for the upload → confirm → parse pipeline
