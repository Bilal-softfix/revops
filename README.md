# RevOps Platform

An AI-assisted Revenue Operations platform for lead-driven small and mid-sized businesses in India.

RevOps brings the whole lead lifecycle into one system: **capture every lead → answer every call (human first, AI voice fallback) → keep one CRM timeline per contact → follow up automatically → report on which sources produce revenue.**

> **Status:** active development. Milestones M0 (Foundation) and M1 (CRM Core) are complete; M2 (Lead Capture & Dedupe) is in progress. See [docs/milestones/PROGRESS.md](docs/milestones/PROGRESS.md) for the current state.

---

## Table of contents

- [Key capabilities](#key-capabilities)
- [Architecture](#architecture)
- [Repository layout](#repository-layout)
- [Getting started](#getting-started)
- [Common commands](#common-commands)
- [Testing](#testing)
- [Engineering principles](#engineering-principles)
- [Roadmap](#roadmap)
- [Documentation](#documentation)
- [Development workflow with Claude Code](#development-workflow-with-claude-code)
- [Contributing](#contributing)

---

## Key capabilities

| Area | What it does |
|---|---|
| **Lead capture** | Embeddable web forms, signed inbound webhooks and (later) Meta Lead Ads, all landing in one deduplicated CRM. |
| **Unified CRM** | Contacts, leads, configurable pipelines and stages, custom fields and a single activity timeline per contact. |
| **Call routing** | Human-first inbound routing with an AI voice agent picking up when nobody answers. |
| **Automation** | Event-driven follow-ups, including WhatsApp templates, SMS and email. |
| **Reporting** | Source-to-revenue dashboards and per-tenant usage and cost metering. |
| **Multi-tenant by design** | Every tenant's data is isolated at the database level with PostgreSQL Row-Level Security. |
| **Segment-agnostic** | Industry templates (real estate, education, clinics and more) are stored as data, not code. |

Built for the Indian market: `Asia/Kolkata` as the default timezone, INR amounts stored in paise, E.164 phone numbers, and production data hosted in AWS `ap-south-1` (Mumbai). See [docs/03-india-compliance.md](docs/03-india-compliance.md) for DPDP, TRAI/DLT, call-recording and WhatsApp opt-in requirements.

## Architecture

A lean **modular monolith** in a TypeScript monorepo, plus a Python voice agent.

```
                 ┌──────────────┐
  Browser ──────▶│   apps/web   │  Next.js (App Router) · same-origin /api proxy
                 └──────┬───────┘
                        │ REST /v1
                 ┌──────▼───────┐        ┌──────────────────┐
  Webhooks ─────▶│   apps/api   │◀──────▶│ apps/voice-agent │  Python · LiveKit Agents
  Web forms      │  HTTP (main) │        └──────────────────┘
                 │  Worker      │  pg-boss jobs · outbox relay · schedulers
                 └──────┬───────┘
                        │ withTenant() → RLS
                 ┌──────▼───────┐
                 │ PostgreSQL 18│  RLS · pgvector · pg-boss · rate limits
                 └──────────────┘
```

| Layer | Technology |
|---|---|
| Monorepo | pnpm workspaces, Turborepo, Node.js 22 LTS, TypeScript (strict) |
| Web | Next.js (App Router), React, Tailwind CSS, shadcn/ui, TanStack Query, React Hook Form + Zod |
| API | NestJS with two entrypoints: `main.ts` (HTTP) and `worker.ts` (job consumers, outbox relay, schedulers) |
| Voice agent | Python 3.12, LiveKit Agents, uv, ruff, mypy, pytest |
| Database | PostgreSQL 18 with Row-Level Security and pgvector; Drizzle ORM and drizzle-kit migrations |
| Jobs & queues | pg-boss on Postgres; no Redis ([ADR-011](docs/04-decisions.md)) |
| Storage | `StorageProvider` adapter: local disk in development, S3 (`ap-south-1`) in production |
| Observability | pino structured logs, OpenTelemetry traces, Prometheus metrics, OpenAPI docs generated from Zod |

Full details are in [docs/01-architecture.md](docs/01-architecture.md) and [docs/02-data-model.md](docs/02-data-model.md).

## Repository layout

```
.
├── apps/
│   ├── web/            Next.js front end
│   ├── api/            NestJS API and background worker
│   └── voice-agent/    Python AI voice agent (LiveKit)
├── packages/
│   ├── db/             Drizzle schema, migrations, seed, withTenant()
│   ├── shared/         Zod schemas, DTOs, event contracts, enums, crypto
│   └── config/         Shared ESLint, TypeScript and Prettier presets
├── scripts/            Cross-platform tooling (doctor, db:bootstrap, CI helpers)
├── docs/               Architecture, data model, compliance, ADRs, milestones
├── .claude/            Claude Code commands, subagents and hooks
└── CLAUDE.md           Project rules and conventions for AI-assisted development
```

## Getting started

Local development is **local-first and Docker-free** ([ADR-009](docs/04-decisions.md), [ADR-012](docs/04-decisions.md)): everything runs against a natively installed PostgreSQL 18, with no Redis and no paid or cloud services. The complete guide is [docs/05-local-dev-setup.md](docs/05-local-dev-setup.md).

### Prerequisites

- **Node.js 22** (`>=22.12.0 <23`); the version is enforced, so other Node versions fail fast
- **pnpm 10** via Corepack (`corepack enable` under Node 22)
- **PostgreSQL 18** installed natively and listening on `localhost:5432` (pgvector is optional until M4)
- **Python 3.12** and **uv**, only for working on the voice agent

### Setup

1. **Install dependencies**

   ```bash
   pnpm i
   ```

2. **Create environment files.** Copy `.env.example` to `.env` at the repo root, and `apps/api/.env.example` to `apps/api/.env` (plus `apps/web` and `apps/voice-agent` as needed). Set `DB_BOOTSTRAP_URL` to a local Postgres superuser.

3. **Bootstrap the databases.** This creates `revops_dev` and `revops_test`, the `revops_owner` and `app_user` roles and the extensions, and writes the connection strings into your env files. It is idempotent.

   ```bash
   pnpm run db:bootstrap --write-env
   ```

4. **Migrate and seed**

   ```bash
   pnpm db:migrate
   pnpm db:migrate --test
   pnpm db:seed          # requires SEED_PASSWORD (12+ characters) in .env
   ```

5. **Check your environment**

   ```bash
   pnpm run doctor
   ```

6. **Start everything**

   ```bash
   pnpm dev
   ```

| Service | URL |
|---|---|
| Web app | http://localhost:3000 |
| API | http://localhost:4000 |
| API docs (Swagger UI) | http://localhost:4000/docs |
| Worker (health and metrics) | http://localhost:4001 |

Sign in with the seeded demo users, using the password you set in `SEED_PASSWORD`. In development, outgoing emails such as verification and invitation links are printed in the **worker** terminal.

## Common commands

| Command | Description |
|---|---|
| `pnpm dev` | Run all apps in watch mode |
| `pnpm build` | Build all packages and apps |
| `pnpm typecheck` | Type-check the whole monorepo |
| `pnpm lint` | Lint the whole monorepo |
| `pnpm format` | Format with Prettier |
| `pnpm run doctor` | Check env vars, database connectivity and roles (`pnpm doctor` is a pnpm built-in, so use `run`) |
| `pnpm run db:bootstrap --write-env` | One-off database and role setup from `DB_BOOTSTRAP_URL` |
| `pnpm db:generate --name=<change>` | Generate a new migration from the Drizzle schema |
| `pnpm db:migrate` | Apply migrations to the dev database (`--test` for the test database) |
| `pnpm db:seed` | Seed two demo tenants (idempotent; refuses to run in production) |
| `pnpm db:reset:dev` | Drop and rebuild the **dev** database, then re-seed |

## Testing

| Command | Scope |
|---|---|
| `pnpm test` | Unit tests (Vitest) |
| `pnpm test:integration` | Repository and API tests against `DATABASE_URL_TEST`, including cross-tenant leak tests |
| `pnpm test:e2e` | Playwright end-to-end tests against built apps on ports 3100, 4100 and 4101 |
| `cd apps/voice-agent && uv run pytest && uv run ruff check . && uv run mypy .` | Voice agent tests, lint and type checks |

Before your first e2e run, install the browser once with `pnpm --filter @revops/web exec playwright install chromium`, and migrate the test database. Don't run the e2e and integration suites at the same time, because both use `revops_test`.

**Continuous integration** (GitHub Actions, [.github/workflows/ci.yml](.github/workflows/ci.yml)) runs typecheck, lint, unit tests and the build on Ubuntu and Windows, plus integration tests against Postgres 18 with pgvector and the Playwright e2e suite.

## Engineering principles

These rules are non-negotiable. The full list is in [CLAUDE.md](CLAUDE.md).

- **Tenant isolation.** Every tenant-owned table has `tenant_id` and an RLS policy. All access goes through `withTenant(...)`, and every new table ships with a cross-tenant leak test.
- **Validation at the edge.** Every API input and webhook payload is validated with a Zod schema from `packages/shared`. No `any`.
- **Provider adapters only.** Telephony, STT, TTS, LLM, WhatsApp, email, SMS and ads APIs are called only through interfaces in `apps/api/src/providers/*`, and each has a `Fake*` implementation for tests and local development.
- **Events via outbox.** State changes write to `outbox_events` in the same transaction, and consumers are idempotent.
- **Webhooks.** Verify the signature, persist the raw payload, return 2xx fast and process asynchronously.
- **Secrets and PII.** Provider tokens use envelope encryption at rest. Phone numbers are stored in E.164 and masked in logs. Secrets are never logged.
- **Money.** Amounts are stored as integer paise (`bigint`), never floats, and every billable action records a usage event.
- **Migrations.** Forward-only and reviewed. Merged migrations are never edited, and destructive changes take two steps.
- **AI actions.** Permissioned and audit-logged, and they never change ad spend without explicit human approval.

## Roadmap

| Milestone | Scope | Status |
|---|---|---|
| **M0** | Foundation: monorepo, CI, auth, tenancy, RBAC, RLS, jobs, observability, web shell | ✅ Done |
| **M1** | CRM core: contacts, leads, pipelines, custom fields, industry templates, timeline | ✅ Done |
| **M2** | Lead capture and dedupe: lead sources, web forms, webhooks, dedupe engine, round-robin assignment | 🚧 In progress |
| **S1** | Voice and telephony spike (de-risks M3/M4) | Planned |
| **M3** | Telephony and human-first call routing | Planned |
| **M4** | AI voice agent | Planned |
| **M5** | Automation and follow-up (WhatsApp, SMS, email) | Planned |
| **M6** | Reporting and usage metering | Planned |
| **M7** | Meta Lead Ads integration with campaign, ad set and ad attribution | Planned |
| **M8** | Production readiness and pilot launch | Planned |

Google Ads, AI lead scoring, a visual workflow builder and an AI growth manager are on the post-MVP backlog. See [docs/00-execution-plan.md](docs/00-execution-plan.md) for phases, gates and dependencies.

## Documentation

| Document | Contents |
|---|---|
| [docs/00-execution-plan.md](docs/00-execution-plan.md) | Goals, phase map, dependency graph, session protocol and human checkpoints |
| [docs/01-architecture.md](docs/01-architecture.md) | Modules, tenancy, events and provider adapters |
| [docs/02-data-model.md](docs/02-data-model.md) | Core entities and relationships |
| [docs/03-india-compliance.md](docs/03-india-compliance.md) | DPDP, TRAI/DLT, call recording, WhatsApp opt-in, data residency |
| [docs/04-decisions.md](docs/04-decisions.md) | Architecture Decision Records (ADRs) |
| [docs/05-local-dev-setup.md](docs/05-local-dev-setup.md) | Detailed local setup, CI and troubleshooting |
| [docs/milestones/](docs/milestones/) | Per-milestone scope, tasks and acceptance criteria |
| [docs/milestones/PROGRESS.md](docs/milestones/PROGRESS.md) | Live progress log, assumptions, tech debt and external blockers |

## Development workflow with Claude Code

The project is built milestone by milestone with [Claude Code](https://claude.com/claude-code). [CLAUDE.md](CLAUDE.md) gives every session its rules and conventions, and `.claude/` provides:

| Command | Purpose |
|---|---|
| `/start-milestone <id>` | Read the milestone spec and propose a task plan for approval |
| `/implement-task <id>` | Implement one task end to end, including tests and the Definition of Done |
| `/review-milestone <id>` | Run the end-of-milestone quality and security gate |
| `/adr` | Record an architecture decision |

Supporting subagents (`code-reviewer`, `test-writer`, `security-auditor`) live in `.claude/agents/`. A cross-platform Node hook formats and lints files after each edit and blocks reads of secret files.

**Typical cycle:** `/start-milestone M2` → approve the plan → implement task by task → `/review-milestone M2` → human review → merge → next milestone. Keep [PROGRESS.md](docs/milestones/PROGRESS.md) up to date before clearing a session.

## Contributing

- Branch per milestone (`milestone/<id>-<name>`) and open a pull request to `main`.
- Use [Conventional Commits](https://www.conventionalcommits.org/), for example `feat(crm): add contact merge`.
- A task is done when its acceptance criteria are met, the unit, integration and leak tests pass, `pnpm typecheck && pnpm lint && pnpm test` is green, docs and OpenAPI are updated, and PROGRESS.md records the change.
- Changes to the stack require an ADR in [docs/04-decisions.md](docs/04-decisions.md).
- Scripts must work on Windows, macOS and Linux.
