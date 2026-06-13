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

- **Sentry** — error tracking (frontend + backend)
- **Axiom** — structured application logs (NestJS)
- **PostHog** — user analytics and funnels (IP anonymisation enabled, no PII in events)
- **BetterUptime** — external uptime monitoring

## Security Constraints

- TypeORM parameterised queries only — no raw SQL string concatenation
- All inputs validated with `class-validator` DTOs before entering business logic
- CV files served only via short-lived presigned URLs — never directly
- Stripe and Clerk webhook signatures verified on every inbound request
- No `.env` files in version control; secrets managed via Railway and Vercel environment settings
- CORS restricted to the production frontend origin
- Rate limiting: 5 AI requests per user per 10-minute window (Redis token bucket)
