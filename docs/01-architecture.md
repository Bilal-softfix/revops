# 01 — Architecture

## Shape
Modular monolith in NestJS + one Python voice worker. Modules talk via service interfaces in-process, and via outbox events for async side effects. Any module can be extracted later because boundaries + events are already in place.

```
           ┌──────────── apps/web (Next.js) ─────────────┐
           │ dashboard · CRM · inbox · settings · reports│
           └───────────────┬─────────────────────────────┘
                           │ REST /v1 (cookie session)
┌──────────────────────── apps/api (NestJS) ────────────────────────┐
│ identity · tenancy · crm · capture · telephony · conversations    │
│ automation · messaging · reporting · usage · integrations(meta)   │
│        │ outbox_events (same tx)                                  │
│        ▼                                                          │
│  worker.ts: outbox relay → BullMQ queues → consumers, schedulers  │
└──────┬──────────────┬─────────────────┬───────────────────────────┘
       │              │                 │
  PostgreSQL 16     Redis 7       Storage adapter (local disk dev / S3 prod)
  (RLS, pgvector)   (BullMQ)
       ▲
       │ internal API (service token)
┌──────┴──────── apps/voice-agent (Python, LiveKit Agents) ─────────┐
│ STT ↔ LLM ↔ TTS pipeline · tenant playbook · tools: lookup_lead,   │
│ save_qualification, book_callback, transfer_to_human, end_call     │
└──────┬────────────────────────────────────────────────────────────┘
       │ SIP / media stream
  Telephony provider (decided in S1)  ←→  PSTN caller / human agent phone
```

## Modules (apps/api/src/modules)
| Module | Owns |
|---|---|
| identity | users, sessions, password reset, invitations |
| tenancy | tenants, memberships, roles, settings, business hours, `withTenant` |
| crm | contacts, leads, pipelines, stages, custom fields, notes, tasks, timeline |
| capture | lead sources, form endpoints, webhook ingest, CSV import, dedupe, attribution fields |
| telephony | phone numbers, routing rules, call sessions, ring groups, recordings |
| conversations | transcripts, summaries, qualification results, AI playbooks, knowledge base (pgvector) |
| automation | rules (trigger → conditions → actions), scheduled jobs, reminders |
| messaging | WhatsApp/email/SMS sending via adapters, templates, consent checks |
| reporting | aggregate queries + materialized views for dashboards |
| usage | usage_events, cost rates, per-tenant limits & alerts |
| integrations | Meta OAuth, token vault, lead sync; later Google Ads |
| audit | audit_logs for sensitive + AI actions |

## Tenancy
- Shared DB, shared schema, `tenant_id` on every tenant table.
- Postgres RLS: `ALTER TABLE ... ENABLE ROW LEVEL SECURITY; FORCE ROW LEVEL SECURITY;` policy `tenant_id = current_setting('app.tenant_id')::uuid`.
- App connects as a non-owner role (`app_user`); migrations run as owner.
- `withTenant(db, tenantId, fn)` (`@revops/db`) opens a transaction and runs `select set_config('app.tenant_id', $1, true)`, the transaction-local equivalent of `SET LOCAL`. Never use a session-level `SET`: `DATABASE_URL` is Neon's PgBouncer endpoint in transaction mode, so session state would leak to other clients' transactions. Jobs carry `tenantId` in their payload and use the same helper.
- Policies compare against `nullif(current_setting('app.tenant_id', true), '')::uuid`. After a transaction-local value ends, a pooled connection reads the setting back as `''`; `nullif` turns that into NULL, so a query outside `withTenant` sees no rows instead of hitting a uuid cast error.
- New tenant table: generate the RLS SQL with `tenantRlsSql()` (`packages/db/src/rls.ts`) into a custom migration (`pnpm db:generate --custom --name=<table>_rls`), then register the table in `packages/db/test/tenant-tables.ts`. The catalog meta-test fails until both are done. App grants are explicit per table; there are no default privileges.
- `users` is global (no `tenant_id`, no RLS), because login looks a user up by email before any tenant context exists.
- Data model allows a future `agency` tenant managing child tenants (`parent_tenant_id`), no agency UI in MVP.

## RBAC (MVP)
| Role | Can |
|---|---|
| owner | everything incl. billing, integrations, delete tenant |
| admin | everything except billing/delete tenant |
| manager | all leads, reports, routing & automation config |
| agent | own/assigned leads, take calls, tasks, notes |
Permissions are strings (`lead.read.all`, `lead.read.assigned`, `routing.manage`…) mapped from roles, checked with a Nest guard + decorator.

## Events
Outbox row: `{ id, tenant_id, type, aggregate_id, payload jsonb, occurred_at, published_at }`. Relay publishes to BullMQ queue per consumer group. Event types are versioned Zod schemas in `packages/shared/events`, e.g. `lead.created.v1`, `lead.stage_changed.v1`, `call.completed.v1`, `call.missed.v1`, `qualification.saved.v1`, `task.due.v1`.

## Provider adapters (apps/api/src/providers)
`TelephonyProvider`, `MessagingProvider` (whatsapp/sms/email), `LlmProvider`, `SttProvider`/`TtsProvider` (used by voice agent via config), `AdsLeadProvider` (Meta). Each has: interface, real impl, `Fake` impl, contract tests that both must pass.

Candidates to benchmark (S1): telephony — Exotel, Plivo, Twilio(+SIP trunk); STT — Deepgram, Sarvam, Google; TTS — Sarvam, ElevenLabs, Google, Cartesia; LLM — any low-latency model with tool calling. Criteria: Hindi/Hinglish quality, end-to-end latency, ₹/minute, India number availability, SIP/streaming support.

## Call routing flow (MVP)
1. Inbound call hits tenant number → provider webhook → `telephony` creates `call_session`, finds/creates contact+lead (source = phone).
2. Evaluate routing rule: business hours? ring group (sequential or simultaneous) with `ring_timeout_sec`.
3. Human answers → bridged, recorded (with announcement), `call.completed` on hangup.
4. No answer / busy / after hours → connect caller to voice agent room with tenant playbook + lead context.
5. Agent qualifies, can `transfer_to_human` (re-attempt ring group) or `book_callback` → task.
6. On end: transcript + summary + structured qualification → `conversations`, timeline entry, events fire automation.

## Deployment (MVP)
- Local dev: no Docker; apps run natively, data services are cloud dev instances (docs/05-local-dev-setup.md).
- Docker images for web, api, worker, voice-agent are built in CI only (multi-stage Dockerfiles written in M8).
- Prod: managed Postgres + Redis in ap-south-1, containers on ECS/Fly/Render-style platform (decide in M8 ADR), S3 private bucket, LiveKit Cloud or self-hosted (S1 decides).
- Kubernetes, Kafka, ClickHouse, Temporal: explicitly deferred — see ADRs for revisit triggers.
