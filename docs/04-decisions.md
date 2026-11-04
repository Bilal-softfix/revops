# 04 — Architecture Decision Records

## ADR-001 Modular monolith (NestJS) + Python voice worker
Status: Accepted · Context: small team, Claude Code-driven, unvalidated market. · Decision: one NestJS codebase with domain modules + separate worker process; only voice agent is a separate service (Python, LiveKit Agents ecosystem). · Consequences: fast delivery, one deploy unit; must enforce module boundaries by convention + lint rules. · Revisit when: a module needs independent scaling or a separate team.

## ADR-002 BullMQ + Postgres outbox instead of Kafka/Temporal
Status: Accepted · Decision: outbox table → relay → BullMQ queues; delayed jobs for reminders/callbacks. · Consequences: zero extra infra beyond Redis; durable long-running workflows are hand-rolled with idempotent steps. · Revisit when: multi-step workflows with human approvals get complex (consider Temporal), or event fan-out > ~50 consumers / analytics streaming (consider Redpanda).

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
Status: Accepted · Context: Docker Desktop unavailable and not permitted on Dev's machine. · Decision: apps run natively (Node 22, Python 3.12 + uv); Postgres = Neon (pgvector), Redis = Redis Cloud, storage = local disk adapter in dev, email = console adapter, LiveKit = LiveKit Cloud. Integration tests use a separate test database instead of Testcontainers; CI uses GitHub service containers. Scripts must be cross-platform. · Consequences: needs internet for dev; never put real customer data in dev services; slight DB latency. · Revisit when: Docker or native Postgres/Redis becomes allowed.
