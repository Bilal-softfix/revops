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
- `withTenant(tenantId, fn)` opens a transaction and `SET LOCAL app.tenant_id`. Jobs carry `tenantId` in payload and use the same helper.
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
