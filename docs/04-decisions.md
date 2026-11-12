# 04 — Architecture Decision Records

## ADR-001 Modular monolith (NestJS) + Python voice worker
Status: Accepted · Context: small team, Claude Code-driven, unvalidated market. · Decision: one NestJS codebase with domain modules + separate worker process; only voice agent is a separate service (Python, LiveKit Agents ecosystem). · Consequences: fast delivery, one deploy unit; must enforce module boundaries by convention + lint rules. · Revisit when: a module needs independent scaling or a separate team.

## ADR-002 BullMQ + Postgres outbox instead of Kafka/Temporal
Status: **Superseded by ADR-011** (2026-11-11): the outbox stays, BullMQ/Redis is replaced by pg-boss on Postgres. · Decision: outbox table → relay → BullMQ queues; delayed jobs for reminders/callbacks. · Consequences: zero extra infra beyond Redis; durable long-running workflows are hand-rolled with idempotent steps. · Revisit when: multi-step workflows with human approvals get complex (consider Temporal), or event fan-out > ~50 consumers / analytics streaming (consider Redpanda).

## ADR-003 Postgres for analytics in MVP (no ClickHouse)
Status: Accepted · Decision: reporting via indexed queries + materialized views refreshed by worker. · Revisit when: report queries > 2s p95 or events > ~50M rows.

## ADR-004 Drizzle ORM
Status: Accepted · Context: RLS needs per-transaction `SET LOCAL`; want SQL-level control and reviewable migrations. · Decision: Drizzle + drizzle-kit. · Revisit: never casually.

## ADR-005 Shared-schema multitenancy with RLS
Status: Accepted · Decision: tenant_id + forced RLS + non-owner app role + leak tests in CI. · Revisit when: an enterprise customer requires dedicated DB.

## ADR-006 Session auth (httpOnly cookie) built in-house
Status: Accepted · Decision: argon2id passwords, opaque session tokens hashed in DB, CSRF protection, rate-limited login; phone OTP login post-MVP. · Revisit when: SSO/SAML demanded.

## ADR-007 Telephony + voice stack — PENDING (decided by S1 spike)
Fill in after S1: provider, integration mode (SIP trunk into LiveKit vs provider media-stream WebSocket), STT/TTS/LLM choices, measured latency and ₹/min.

## ADR-008 Hosting — PENDING (decide in M8)

## ADR-009 No Docker on developer machine
Status: Accepted; the services part is **amended by ADR-012** (native local Postgres instead of Neon, no Redis) · Context: Docker Desktop unavailable and not permitted on Dev's machine. · Decision: apps run natively (Node 22, Python 3.12 + uv); Postgres = Neon (pgvector), Redis = Redis Cloud, storage = local disk adapter in dev, email = console adapter, LiveKit = LiveKit Cloud. Integration tests use a separate test database instead of Testcontainers; CI uses GitHub service containers. Scripts must be cross-platform. · Consequences: needs internet for dev; never put real customer data in dev services; slight DB latency. · Revisit when: Docker or native Postgres/Redis becomes allowed.

## ADR-010 PostgreSQL 18 (was 16)
Status: Accepted (2026-11-05) · Context: the Neon dev project was created on PostgreSQL 18.6 (Neon's current default) while CLAUDE.md and CI targeted 16. Running dev on 18 while CI tests 16 hides version-specific behaviour in either direction. · Decision: target **PostgreSQL 18** everywhere: Neon dev/test on 18, CI service container `pgvector/pgvector:0.8.6-pg18`, and `pnpm run doctor` requires server_version_num ≥ 180000. The pgvector tag is pinned to a release at least 2 weeks old, per the dependency policy. · Consequences: SQL may use PG18 features. The migrations so far are plain DDL, RLS policies and SECURITY DEFINER functions, which behave the same on 16–18. · **Verify at M8:** the managed production Postgres (e.g. RDS/Aurora ap-south-1, or Neon) supports PG18 with pgvector in our region before choosing hosting (ADR-008). If it doesn't, fall back to the newest version it does support, and run CI on that version for at least one milestone before the switch. · Revisit when: M8 hosting decision, or a PG19 GA + 4 months.

## ADR-011 Postgres-backed queue (pg-boss) and rate limits; no Redis (supersedes ADR-002)
Status: Accepted (2026-11-11) · Context: the product owner wants dev to be local-first with zero paid or cloud services, and fewer moving parts in production. Redis was in the stack only for BullMQ and rate-limit counters. Postgres is already a hard dependency, and the expected MVP load (tens of jobs per second at peak per region, well under 1k/s) is far below what a Postgres queue handles. · Decision:
- **Redis is removed everywhere** (dev, CI and prod): no `REDIS_URL`, no Redis service in CI, no Redis in the M8 infrastructure.
- **Jobs: [pg-boss](https://github.com/timgit/pg-boss) 12.38.0** (Postgres-backed: `SKIP LOCKED` claiming, retries with backoff, delayed/scheduled jobs, cron schedules, dead-letter queues). It sits behind our own queue interface in `apps/api/src/platform` (`JobQueue`/`JobHandler`/`JobRunner`, with an in-memory fake for tests), so it can be swapped later without touching modules. The outbox stays exactly as in ADR-002: state change + `outbox_events` row in one transaction → the relay publishes to pg-boss → idempotent consumers (dedupe on `event_id`). Because pg-boss writes to the same database, the relay can enqueue and mark rows published **in one transaction**, which closes the "published twice" window BullMQ had.
- **pg-boss schema:** its tables live in a separate `pgboss` schema, created by `pnpm db:migrate` as the owner (not by the app at runtime). `app_user` gets only the DML grants pg-boss needs there. Job payloads carry `tenantId`; handlers use `withTenant` like requests do. No RLS is needed in `pgboss` because app code never queries it directly.
- **Rate limits:** a `rate_limit_buckets` table (fixed windows, keyed by the sha256 of the logical key, so no IPs or emails are stored), reached only through the SECURITY DEFINER functions `rate_limit_consume` / `rate_limit_reset` / `rate_limit_purge`. `app_user` has no table privileges. A single `INSERT … ON CONFLICT DO UPDATE` makes count-then-decide atomic. Shared across processes, unlike the in-memory limiter it replaces.
- **Cache:** none in the MVP. If one is needed, use an in-process LRU or a Postgres table first.
- **As built in M0-T6 (2026-11-11):**
  - The interface is `JobQueue` (producer) plus `JobHandler` providers that the worker's `JobRunner` discovers, with `InMemoryJobQueue` as the test fake.
  - Migration 0013 installs the schema from pg-boss's own `getConstructionPlans`. pg-boss then runs as `app_user` with `migrate`, `createSchema` and `reindex` off, because `app_user` owns nothing.
  - Queues are non-partitioned, so `createQueue` is plain DML. Upgrading pg-boss means a new migration from `getMigrationPlans`.
  - **Job payloads never carry secrets.** Signup hashes the password on the request path and enqueues only the hash. Auth and invitation tokens are minted inside the job. Jobs that hold emails are deleted 1 h after completion.
  - The relay reads every tenant's events through `outbox_claim_batch` / `outbox_mark_published` (SECURITY DEFINER). Because `outbox_events` is FORCE RLS, two policies are bound only to the owner role (`TO CURRENT_USER` at migration time). The catalog meta-test asserts that they never apply to `app_user`.
  - The relay sends one job per subscribed consumer queue, with job id = event id. Consumers dedupe through `processed_events` in the same transaction as their side effects (`processOnce`).

Consequences:
- One fewer service to run, secure, back up and pay for.
- Jobs are transactional with business data.
- Queue and limiter load lands on the primary database: more writes, more autovacuum churn on the pg-boss and rate-limit tables, and housekeeping jobs purge old rows.
- Queue lag and table bloat must be monitored (M8-T4).
- pg-boss brings `pg` (node-postgres) as a transitive dependency next to `postgres` (postgres.js). Both processes open a pg-boss pool: the API (max 3, producer only) and the worker (max 6, workers + maintenance + cron). Count them in the M8 connection-limit planning.

Revisit when:
- sustained job throughput passes ~500 jobs/s;
- queue tables measurably hurt OLTP latency (p95 > 2× baseline);
- or we need fan-out to many independent consumers or streaming (then consider Redis/BullMQ again, or Redpanda).

## ADR-012 Local-first development on a native PostgreSQL (amends ADR-009)
Status: Accepted (2026-11-11) · Context: Neon and Redis Cloud made development depend on the internet and on third-party accounts, and the Neon round-trips made the integration suite slow: over 10 minutes locally against about 1 minute in CI. Docker is still not allowed on the dev machine (ADR-009). · Decision:
- Dev and test databases run on a **natively installed PostgreSQL 18** (Windows installer, port 5432). ADR-010 still applies.
- `pnpm run db:bootstrap` reads `DB_BOOTSTRAP_URL`, which replaces `NEON_BOOTSTRAP_URL`. Given a superuser (`postgres`), it creates a dedicated `revops_owner` role (LOGIN, NOSUPERUSER, NOBYPASSRLS) that owns `revops_dev` and `revops_test` and runs the migrations. SECURITY DEFINER functions therefore never run as a superuser, which matches Neon (`neondb_owner`) and CI (`revops_owner`).
- Local URLs carry `sslmode=disable`, and no `-pooler` host is derived for non-Neon hosts.
- Neon support stays in the code (pooled/direct host derivation, the admin-owner mode) but is unused.
- **pgvector** is not yet installed locally. `pnpm run doctor` only warns about it until M4, when the knowledge base needs it. CI keeps the `pgvector/pgvector:0.8.6-pg18` image, so vector code is still tested.

Consequences:
- Dev works offline and the local test loop is fast.
- Each developer installs Postgres 18 once.
- `withTenant`'s transaction-local `set_config` rule stays mandatory, because production may sit behind a transaction pooler again.

Revisit when:
- several developers need shared dev data (consider a hosted dev database again);
- or pgvector can't be installed natively on Windows by M4 (fallback: a Neon branch for vector work only).
