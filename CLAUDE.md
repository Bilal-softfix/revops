# CLAUDE.md — RevOps Platform

AI Revenue Operations Platform for Indian lead-driven SMBs: lead capture → human-first call routing with AI voice fallback → unified CRM → follow-up automation → revenue reporting.

## Read before any task
- `docs/00-execution-plan.md` — workflow and current phase
- `docs/milestones/PROGRESS.md` — what is done, what is next (ALWAYS update after each task)
- The active milestone file in `docs/milestones/`
- `docs/01-architecture.md` and `docs/02-data-model.md` when touching structure or schema

## Stack (do not change without an ADR in docs/04-decisions.md)
- Monorepo: pnpm workspaces + Turborepo. Node 22 LTS. TypeScript strict.
- `apps/web` — Next.js (App Router), React, Tailwind, shadcn/ui, TanStack Query, React Hook Form + Zod
- `apps/api` — NestJS. Two entrypoints: `main.ts` (HTTP) and `worker.ts` (BullMQ consumers, outbox relay, schedulers)
- `apps/voice-agent` — Python 3.12, LiveKit Agents, uv for deps, ruff + mypy + pytest
- `packages/db` — Drizzle ORM + drizzle-kit migrations, PostgreSQL 16 with RLS and pgvector
- `packages/shared` — Zod schemas, DTO types, event contracts, enums (single source of truth for web + api)
- `packages/config` — eslint, tsconfig, prettier presets
- Redis 7 (BullMQ, rate limits, cache). Object storage behind a `StorageProvider` adapter: `LocalDiskStorage` in dev, S3 (ap-south-1) in prod.
- **NO DOCKER on the dev machine.** Local dev uses cloud dev services (Neon Postgres, Redis Cloud) via env vars — see `docs/05-local-dev-setup.md`. Never add docker-compose or Testcontainers as a requirement for local work. CI (GitHub Actions) may use service containers.
- Observability: pino structured logs, OpenTelemetry traces, Prometheus metrics.

## Commands
- `pnpm i` · `pnpm dev` (all apps) · `pnpm doctor` (checks env vars + DB/Redis connectivity)
- `pnpm typecheck` · `pnpm lint` · `pnpm test` · `pnpm test:e2e` · `pnpm build`
- `pnpm db:generate` (new migration) · `pnpm db:migrate` · `pnpm db:seed`
- Voice agent: `cd apps/voice-agent && uv run pytest && uv run ruff check . && uv run mypy .`

## Non-negotiable rules
1. **Tenant isolation:** every tenant-owned table has `tenant_id uuid not null` + an RLS policy. All DB access goes through `withTenant(tenantId, tx => ...)` which sets `app.tenant_id`. Never query tenant tables without it. Every new table needs a cross-tenant leak test.
2. **Validation at the edge:** every API input validated with a Zod schema from `packages/shared`. No `any`. No unvalidated webhook payloads.
3. **Provider adapters only:** telephony, STT, TTS, LLM, WhatsApp, email, SMS, ads APIs are called ONLY via interfaces in `apps/api/src/providers/*`. Each has a `Fake*` implementation used in tests and local dev.
4. **Events via outbox:** state changes that other modules care about write a row to `outbox_events` in the same transaction. Consumers must be idempotent (dedupe on `event_id`).
5. **Webhooks:** verify signature, persist raw payload to `inbound_webhooks`, return 2xx fast, process async. Idempotent on provider event id.
6. **Secrets:** never hardcode, never log. Provider tokens encrypted at rest (envelope encryption, `packages/shared/crypto`). Never read `.env*` files — use `.env.example`.
7. **PII:** phone numbers stored in E.164, masked in logs (`+91******3210`). Recordings and transcripts follow retention settings per tenant.
8. **Money & usage:** store paise as integer (`bigint`), never floats. Every billable action writes a `usage_events` row.
9. **Migrations:** forward-only via drizzle-kit, reviewed SQL, never edit a merged migration. Destructive changes need a two-step migration.
10. **AI actions** are permissioned, logged in `audit_logs`, and never change ad spend/budgets without explicit human approval.

## Code conventions
- NestJS module per domain: `apps/api/src/modules/<domain>/{controller,service,repository,dto,events}.ts`. Controllers thin; business logic in services; SQL in repositories.
- Errors: throw typed domain errors → mapped to RFC 7807 problem+json by a global filter.
- API: REST, `/v1/...`, cursor pagination, OpenAPI generated from Zod (`@anatine/zod-openapi` or equivalent).
- Frontend: server components for data-heavy pages, client components only where interactive. Every page handles loading, empty, error states.
- Names: files kebab-case, types PascalCase, DB snake_case, API JSON camelCase.
- Times: store UTC `timestamptz`; display in tenant timezone (default `Asia/Kolkata`).
- UI copy in English for MVP; keep strings in one place per feature for future Hindi i18n.

## Definition of Done (every task)
- [ ] Acceptance criteria in the milestone file met
- [ ] Unit tests for services + integration tests against the test database (`DATABASE_URL_TEST`) for repositories/APIs
- [ ] Tenant leak test if a tenant table was added/changed
- [ ] `pnpm typecheck && pnpm lint && pnpm test` green
- [ ] OpenAPI + `docs/` updated if contracts changed
- [ ] `docs/milestones/PROGRESS.md` updated, conventional commit made (`feat(crm): ...`)

## How to work
- Use Plan Mode first for any task touching >3 files. Show the plan, wait for approval.
- Small vertical slices: schema → repository → service → controller → UI → tests.
- If a requirement is ambiguous, ask — don't invent product behaviour. Log assumptions in PROGRESS.md.
- If you hit something that needs a real external account (Meta, Exotel, etc.), build against the Fake adapter and add an item to "Blocked on external" in PROGRESS.md.
- Do not add new dependencies without stating why; prefer what's already in the stack.
- Commands and scripts must work on Windows, macOS and Linux (use Node scripts / cross-env, not bash-only scripts).
