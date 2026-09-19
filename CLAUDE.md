# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

CVPilot is an AI-powered CV analysis and cover letter generation SaaS targeting university students and recent graduates. Users upload a CV, paste a job description, receive an AI-generated match score with inline feedback, and can generate a tailored cover letter in one click. Billing is handled via Stripe with Free, Pro (£9.99/mo), and Student Bundle (£4.99/mo for `.ac.uk` emails) tiers.

## Repository Structure

This is a monorepo containing two applications:

- `apps/web` — Next.js 14+ frontend (App Router, TypeScript), deployed to Vercel
- `apps/api` — NestJS backend (Node.js, TypeScript), deployed to Railway
- `packages/` — shared types and utilities

## First-time Setup

**Requires Node.js 20+ and npm 10+.** Install from https://nodejs.org/

```bash
# 1. Install all workspace dependencies (run from repo root)
npm install

# 2. Initialize Husky pre-commit hooks
npm run prepare

# 3. Copy env templates and fill in values
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env.local

# 4. Start local Postgres + Redis
docker compose up -d
```

## Common Commands

### Local Development

```bash
# Start local dependencies (Postgres + Redis)
docker compose up -d

# Start both apps concurrently (from repo root)
npm run dev

# Or start individually:
cd apps/web && npm run dev        # Next.js on :3000
cd apps/api && npm run dev        # NestJS on :3001

# Run all tests
npm run test

# Run a single test file (from apps/api)
npm run test -- --testPathPattern=analysis.service

# Run e2e tests (requires running local DB)
cd apps/api && npm run test:e2e

# Lint everything
npm run lint

# Type check everything
npm run typecheck
```

### Database

```bash
# Run TypeORM migrations
cd apps/api && npm run migration:run

# Generate a new migration
cd apps/api && npm run migration:generate -- src/migrations/MigrationName

# Revert last migration
cd apps/api && npm run migration:revert
```

### Webhook development

Use ngrok to expose the local API for Stripe and Clerk webhooks:

```bash
ngrok http 3001
```

Register the ngrok URL in the Stripe dashboard (`/api/webhooks/stripe`) and Clerk dashboard (`/webhooks/clerk`).

## Architecture

### System Layers

```
Browser → Cloudflare (CDN/WAF) → Next.js on Vercel → NestJS API on Railway
                                                      ↓
                                         PostgreSQL (Neon) + Redis (Upstash)
                                         Cloudflare R2 (file storage)
                                         OpenAI / Anthropic / Stripe / Resend
```

### Backend: NestJS Modular Monolith

The API is organised as a modular monolith. Each module owns its own controllers, services, repositories, and DTOs. **Modules must never import another module's repository directly — cross-module data access goes through a public service method.** This keeps modules extractable into microservices if needed later.

| Module               | Responsibilities                                     | DB Tables                    |
| -------------------- | ---------------------------------------------------- | ---------------------------- |
| `AuthModule`         | JWT guard, Clerk webhook handler                     | —                            |
| `UserModule`         | User CRUD, GDPR deletion                             | `users`, `profiles`          |
| `CVModule`           | Upload orchestration, presigned R2 URLs, CV metadata | `cvs`, `cv_versions`         |
| `ParsingModule`      | Text extraction from PDF/DOCX (background worker)    | updates `cvs.parsed_content` |
| `AnalysisModule`     | AI analysis pipeline, stores results                 | `analyses`, `ats_reports`    |
| `CoverLetterModule`  | Cover letter generation, editing, versioning         | `cover_letters`              |
| `BillingModule`      | Stripe checkout, webhook handling, plan enforcement  | `subscriptions`, `payments`  |
| `DashboardModule`    | Aggregated read-only queries for the dashboard       | read-only                    |
| `NotificationModule` | Transactional email (Resend), SSE push               | `notifications`              |
| `AuditModule`        | Append-only audit log, consumed by all modules       | `audit_logs`                 |

### AI Pipeline

All AI calls are **background jobs** (BullMQ on Redis) — never synchronous in the request path. The flow:

1. HTTP request creates a DB record (`status: pending`) and enqueues a BullMQ job
2. Worker picks up the job, calls OpenAI GPT-4o (or Claude 3.5 Sonnet as fallback)
3. Response is validated against a Zod schema; retry up to 3 times if invalid
4. DB record updated to `status: complete`; SSE push notifies the frontend

Primary model: **OpenAI GPT-4o** (temperature 0.2 for analysis, 0.7 for cover letters).  
Fallback: **Anthropic Claude 3.5 Sonnet** — activated automatically by a circuit breaker if OpenAI error rate exceeds 5% over 5 minutes.  
Cost tier: **GPT-4o-mini** for quick keyword extraction.

AI prompts are versioned in the codebase (not the database). Prompts use XML-style delimiters (`<CV_CONTENT>`, `<JOB_DESCRIPTION>`) to separate instructions from user content, reducing prompt injection risk.

### File Upload Flow

CV files are **never uploaded through the NestJS server**. The flow:

1. Frontend calls `POST /api/cvs/upload-url` → NestJS returns a presigned R2 URL (15-min TTL)
2. Frontend uploads directly to Cloudflare R2
3. Frontend calls `POST /api/cvs/confirm` with the R2 object key
4. NestJS enqueues a parsing job; worker extracts text and stores it in `cvs.parsed_content`

### Billing Flow

Stripe webhooks are the source of truth for subscription state. The backend **never polls Stripe** — it reacts to webhook events (`checkout.session.completed`, `customer.subscription.updated`, etc.) and mirrors state into the local `subscriptions` table. `BillingGuard` checks this local record on every gated request — no live Stripe API call in the request path.

## Database Conventions

- **UUID primary keys** on all tables (prevents enumeration; simplifies distributed inserts)
- **Soft deletes** via `deleted_at TIMESTAMPTZ NULL` on all user-facing tables
- **JSONB** for AI outputs (`suggestions`, `keyword_hits`) — flexible enough to evolve without migrations
- **Row-level security (RLS)** enforced at PostgreSQL layer: users can only access their own rows
- `audit_logs` is append-only and never updated or deleted
- All migrations are TypeORM migration files, run automatically on deploy

## Authentication

Authentication is delegated entirely to **Clerk**. The NestJS `ClerkGuard` validates the JWT on every protected route using Clerk's JWKS endpoint (cached locally). The backend maintains its own `users` table synced from Clerk via the `POST /webhooks/clerk` endpoint.

Student Bundle verification is a simple `.ac.uk` domain check in `UserService` — not a Clerk feature.

## Key Environment Variables

Set these in `.env.local` (frontend) and `.env` (backend). See `.env.example` in each app for the full list. Never commit actual values.

**Frontend (`apps/web`)**: `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `NEXT_PUBLIC_API_URL`

**Backend (`apps/api`)**: `DATABASE_URL` (Neon), `REDIS_URL` (Upstash), `CLERK_SECRET_KEY`, `CLERK_WEBHOOK_SECRET`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `CLOUDFLARE_R2_*`, `RESEND_API_KEY`

## Monitoring

- **Sentry** — errors-only (no performance tracing, no Session Replay) error tracking for both
  apps is **prepared in code but not yet live**: `@sentry/nestjs` (api) and `@sentry/nextjs`
  (web) are installed and wired in (`apps/api/src/instrument.ts` + `GlobalExceptionFilter` +
  all four BullMQ job processors; `apps/web/src/instrumentation.ts` +
  `instrumentation-client.ts` + the two React error boundaries), with a shared `beforeSend`
  redaction pass in each app (`apps/api/src/common/monitoring/sentry-scrub.util.ts`,
  `apps/web/src/lib/sentry-scrub.ts`) that strips auth/cookie headers and request bodies and
  unconditionally REPLACES (not truncates — truncation only limits length, not content) every
  exception message/value, breadcrumb message/data, and non-allow-listed `extra` field with a
  safe placeholder before anything is sent, while keeping the error type, tags, allow-listed
  entity-id `extra`, and parsed (variable-free) stack frames. `SENTRY_DSN`
  (api)/`NEXT_PUBLIC_SENTRY_DSN` (web) are already the correct env var names, already read by
  this code, and already reserved (empty) in each `.env.example` — but **no Sentry account or
  project exists yet**, so nothing has ever actually reached a real Sentry dashboard. Verified
  only locally: a mocked-transport pipeline test in each app (including synthetic CV text and a
  fake credential within the first 100 characters of an error, checked against the entire
  serialized event), and a confirmed clean `next build`/`node dist/main.js` boot with no DSN set.
  See RABBIT_NOTEBOOK.md §29–§30 for the exact remaining setup (create the account/projects,
  set the real DSNs in Railway/Vercel, verify one real event reaches the dashboard, configure an
  alert) before this can be considered live.
- **Axiom** — structured application logs (NestJS) — not yet implemented.
- **PostHog** — user analytics and funnels (IP anonymisation enabled, no PII in events) — not
  yet implemented.
- **BetterUptime** — external uptime monitoring, would point at `GET /api/health` — not yet
  implemented.

The Reliability Layer (Production Readiness Phase 1) added `GET /api/health` (checks
PostgreSQL + Redis connectivity) and a wired-up `GlobalExceptionFilter` that logs every
unexpected 5xx server-side. Until Sentry is actually configured with real credentials (see
above), that server-side log line remains the only production error visibility that's
actually live.

## Security Constraints

- TypeORM parameterised queries only — no raw SQL string concatenation
- All inputs validated with `class-validator` DTOs before entering business logic
- CV files served only via short-lived presigned URLs — never directly
- Stripe and Clerk webhook signatures verified on every inbound request
- No `.env` files in version control; secrets managed via Railway and Vercel environment settings
- CORS restricted to the production frontend origin
- Global rate limiting: 100 requests/minute per IP (`ThrottlerModule`), all routes
- AI rate limiting: 5 AI requests per authenticated user per rolling 10-minute
  window, shared across every paid AI operation (CV analysis, cover letter
  generation and regeneration, CV tailoring, CV-upload prefill) — not a
  separate budget per feature. Implemented as a Redis sorted-set sliding-window
  log (`AiRateLimitGuard`/`AiRateLimitService`, `apps/api/src/common/rate-limit`),
  atomic via a single Lua script (safe across concurrent requests and multiple
  API instances), keyed by the Clerk-verified user id from `ClerkGuard` —
  never a client-suppliable identifier. Runs before the route handler, so a
  rejected request never enqueues an AI job or reaches a plan-usage check.
  Exceeding the limit returns `429` with a `Retry-After` header and a plain-text
  message; if Redis itself is unreachable, these five endpoints return `503`
  rather than silently admitting unlimited requests. See RABBIT_NOTEBOOK.md for
  the endpoint-by-endpoint trace and verification.
