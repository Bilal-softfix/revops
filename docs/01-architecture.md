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
│  worker.ts: outbox relay → pg-boss queues → consumers, cron       │
└──────┬──────────────┬─────────────────┬───────────────────────────┘
       │              │                 │
  PostgreSQL 18                   Storage adapter (local disk dev / S3 prod)
  (RLS, pgvector, pg-boss queues, rate limits — no Redis, ADR-011)
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
- `withContext(db, { tenantId, userId }, fn)` (`@revops/db`) opens a transaction and runs `set_config('app.tenant_id', …, true)` and `set_config('app.user_id', …, true)`, the transaction-local equivalent of `SET LOCAL`. Unset values are written as `''`. `withTenant(db, tenantId, fn)` is the tenant-only shorthand. Never use a session-level `SET`: `DATABASE_URL` may point at a transaction-mode pooler (PgBouncer, Neon's pooled endpoint, a managed proxy in prod), where session state would leak to other clients' transactions. Jobs carry `tenantId` in their payload and use the same helper.
- Policies compare against `nullif(current_setting('app.tenant_id', true), '')::uuid`. After a transaction-local value ends, a pooled connection reads the setting back as `''`; `nullif` turns that into NULL, so a query outside `withTenant` sees no rows instead of hitting a uuid cast error.
- New tenant table: generate the RLS SQL with `tenantRlsSql()` (`packages/db/src/rls.ts`) into a custom migration (`pnpm db:generate --custom --name=<table>_rls`), then register the table in `packages/db/test/tenant-tables.ts`. The catalog meta-test fails until both are done. App grants are explicit per table; there are no default privileges.
- **User-scoped tables** (`users`, `sessions`, `auth_tokens`; global, no `tenant_id`) have RLS **enabled but not forced**, with policies on `app.user_id`:
  - `users`: visible if it is the user itself or a member of the current tenant; insert and update self only; no delete.
  - `sessions` and `auth_tokens`: only the acting user's rows.
- Not forcing RLS on these tables lets the owner-owned **SECURITY DEFINER** functions read them for the few context-free auth steps. Each function has a fixed `search_path = pg_catalog, public, pg_temp`, returns only the fields its caller needs, and has EXECUTE for `app_user` only:
  - `auth_find_user_by_email` returns id, password_hash and email_verified_at;
  - `auth_session_lookup` returns a live session by token hash;
  - `auth_consume_token` atomically marks a one-time emailed token used;
  - `auth_peek_verify_token` returns the owner and password hash of a live verify link, without consuming it;
  - `auth_discard_unverified_by_email` / `_by_token` and `auth_purge_expired_unverified` delete unverified accounts with the tenants only they belong to. They go through the internal `auth_discard_unverified_user`, which `app_user` can't call directly. Because tenants/memberships are FORCE RLS, it deletes each tenant inside that tenant's own context.
  Unverified accounts expire **48 h** after signup (`auth_unverified_cutoff()`, the one place this is defined). After that the lookups treat them as non-existent.
  `app_user` is never an owner, so it stays fully bound by these policies.
- **User-only context** (`app.user_id` set, no tenant): a read-only `self_select` policy on `memberships`/`tenants` shows the user its own memberships and the tenants it belongs to. This is used at login and by the tenant switcher (M0-T5). With a tenant set, only `tenant_isolation` applies.
- New SECURITY DEFINER functions and new user-scoped tables are pinned by `packages/db/test/rls-catalog.int.test.ts`. Every table in `public` must be classified there.
- Data model allows a future `agency` tenant managing child tenants (`parent_tenant_id`), no agency UI in MVP.

## Auth (M0-T4, ADR-006)
- **Session:** the `__Host-sid` cookie holds an opaque 32-byte token (httpOnly, Secure, SameSite=Lax, Path=/; the `__Host-` prefix stops sibling subdomains from planting a session). The DB stores only its sha256. Absolute lifetime is 30 days (`expires_at`, checked in SQL); the idle timeout is 7 days, checked against `last_seen_at`, which is updated at most every 5 minutes. The active membership and role are re-checked on every request, so a removed member loses tenant access immediately.
- **CSRF:** `x-csrf-token` = HMAC-SHA256(session token, "csrf.v1"), returned by `/v1/auth/login` and `/v1/auth/me`. It is required on unsafe methods of authenticated routes. Only JSON bodies are parsed (no urlencoded/text parsers), so a cross-site HTML form can't submit to the API.
- **Signup** always answers `202 {"status":"check_email"}` right after validation and the per-IP limit. Everything that depends on the email's state runs as a pg-boss job in the worker (M0-T6). The password is hashed on the request path for every request, so the job row holds only the hash. Neither the body nor the timing reveals whether an account exists:
  - **verified account:** a "you already have an account" email, nothing created;
  - **unverified, pending or expired:** that account and its tenant are discarded and replaced (new password, tenant and link);
  - **new:** one transaction creates the user, tenant, owner membership, audit log, `user.signed_up.v1` outbox event and verification token.
- **Verify email** needs the link **and the account password** (`{token, password}`), so an account pre-registered with someone else's email can't be activated by the inbox owner's click. A bad, used or expired link, an expired account and a wrong password all give `400 verification_failed` after exactly one argon2 verify. Attempts count toward 5 per account per 15 minutes, plus a per-IP limit.
- **"This wasn't me" / start over:** `POST /v1/auth/verify-email/cancel {token}` deletes the unverified account and its tenant.
- No session is created until the email is verified. An unverified account's login gets the **same 401 `invalid_credentials`** as a wrong password, so signup + login can't probe for verified accounts. With the right password, a fresh verification email goes out in the background.
- **Replace limit:** a pending signup can be replaced at most 3 times per email per day, from any IP.
- **Unverified accounts:** forgot-password sends a verify ("this wasn't me") email instead of a reset link, so the inbox owner never inherits someone else's pre-registered account.
- **Atomic verify and reset:** each is one transaction (`auth_verify_email`, `auth_reset_password`). The discard function locks the user row, then each tenant row, so concurrent verify / replace / purge / invite-accept can't interleave.
- **Error logs** (500s, background tasks) go through `safeErrorSummary`: class, SQLSTATE and stack only. Never the message, because drizzle puts query params in it.
- **Rate limits:**
  - Login: 5 attempts per (IP, email) per 15 minutes, reserved atomically *before* the password check and cleared on success, plus 50 per IP. Over the limit: 429 with `Retry-After`.
  - Signup: 10 per IP per hour.
  - Verify/reset emails: 3 per (IP, email) and 20 per IP per hour.
  - Stored in Postgres (ADR-011): `rate_limit_buckets`, keyed by sha256 of the key (no IPs/emails stored), reached only via the definer function `rate_limit_consume` (one atomic upsert), so limits hold across API processes and restarts. Windows follow the app's clock.
  - Unknown emails get a dummy argon2 verify, so timing doesn't reveal which accounts exist.
- **Resend verification and forgot password** always return 202. The lookup, token and email all run in the background. A reset sets the new password, marks the email verified, revokes all sessions and expires the user's other reset links. Links are single-use and expire after 24 hours (verify) or 1 hour (reset).
- **Errors:** RFC 7807 `application/problem+json` with a stable `code` (`AUTH_ERROR_CODES` in `@revops/shared`).

## RBAC (MVP)
| Role | Can |
|---|---|
| owner | everything incl. billing, integrations, delete tenant |
| admin | everything except billing/delete tenant |
| manager | all leads, reports, routing & automation config |
| agent | own/assigned leads, take calls, tasks, notes |
Permissions are strings (`lead.read.all`, `lead.read.assigned`, `routing.manage`…) mapped from roles, checked with a Nest guard + decorator.

**M0-T5 implementation:**
- **Permission map:** `ROLE_PERMISSIONS` in `@revops/shared` (data). M0 has `member.read` (all roles) and `member.invite` + `member.manage` (owner, admin).
- **Guarding a route:** `@RequirePermission('…')` applies `SessionGuard` (session + CSRF) and `PermissionGuard`. The role comes from the active membership, which is re-checked on every request. With no active tenant the route returns 403 `no_active_tenant`; without the permission, 403 `forbidden`.
- **Granting roles:** only owners grant `owner`; admins grant admin/manager/agent. An actor can only change, disable, resend or revoke for roles it may grant, so admins never touch owners.
- **Last owner:** the last active owner can't be demoted or disabled. This is checked under `FOR UPDATE` on the owner rows, so concurrent demotions can't leave none. Nobody can disable themselves.
- **Invitations** (tenant table, FORCE RLS):
  - one open invitation per email per tenant; 7-day, single-use links;
  - resend rotates the link, revoke kills it;
  - the token is `<tenant_id>.<random>`, so accept looks up its sha256 inside that tenant's RLS context, with no definer function.
- **Accepting:**
  - **email with a verified account:** the caller must be signed in as that email; the membership is added and the session switches to the tenant;
  - **otherwise:** name + password create a verified account, discarding any pending unverified one, and sign it in.
  - The invitation is claimed atomically in the same transaction as the membership insert, the audit row and `member.joined.v1`.
- **Tenant switcher:** `GET /v1/tenants` and `POST /v1/session/tenant` work only for the caller's own active memberships (user-only context, `self_select`).

## Web app (apps/web, M0-T7)
- **The browser never calls the API directly.** It calls same-origin `/api/v1/*`, and the route handler `app/api/[...path]/route.ts` forwards that to `API_INTERNAL_URL`, which is read at runtime.
  - Only `/v1` is exposed: `/metrics`, `/docs` and the probes stay internal.
  - The handler forwards a fixed set of request headers: cookie, CSRF, content-type, request id, user-agent and X-Forwarded-For.
  - Every `Set-Cookie` is passed back, so the `__Host-sid` session cookie stays first-party and no CORS is needed.
  - The API derives the client IP from X-Forwarded-For only for hops trusted by `TRUST_PROXY` (default `loopback`).
- **Session:** the `(app)` layout is a Server Component. It calls `GET /v1/auth/me` with the browser's cookie and redirects to `/login` on 401. The session is then held in TanStack Query (`SessionProvider`), and the CSRF token from it is sent as `x-csrf-token` on unsafe calls. Switching tenant replaces the session and refetches all tenant-scoped queries, whose keys include the tenant id.
- **Validation and errors:** forms use react-hook-form with the shared Zod request schemas, and responses are parsed with the shared response schemas. problem+json is mapped to `ApiError` (`code`, field errors, `requestId`, Retry-After), and user-facing copy comes from `lib/strings/*` (one file per feature, ready for Hindi).
- **Navigation is data** (`lib/nav.ts`): each item names the permission that guards its API, and the sidebar shows only what the role can use. Pages re-check on the server (`notFound()`), and the API enforces it anyway.
- **States:** every page has loading (skeletons, `loading.tsx`), empty and error (message + support reference + retry; `error.tsx`, `global-error.tsx`) states.
- **UI kit:** shadcn/ui (radix-nova) in `components/ui` with the system font stack, so builds don't download fonts.

## Events
Outbox row: `{ id, tenant_id, type, aggregate_id, payload jsonb, occurred_at, published_at }`. The worker's relay (`apps/api/src/platform/outbox`, M0-T6) runs one transaction every `OUTBOX_POLL_INTERVAL_MS`:
- `outbox_claim_batch(100)` claims up to 100 events (FOR UPDATE SKIP LOCKED);
- it enqueues one pg-boss job per subscribed consumer queue, with job id = event id, carrying the `outboxEnvelopeSchema` envelope;
- `outbox_mark_published` marks the batch published.

Concurrent or repeated relay runs never publish an event twice. Consumers extend `OutboxConsumer` (`events` they subscribe to, one queue each) and wrap their side effects in `processOnce`, which records `processed_events(consumer, event_id)` in the same tenant transaction. `platform.demo-event-log` is the template consumer.

### Jobs and processes
- **API (`main.ts`):** enqueues through `JobQueue` and runs no jobs.
- **Worker (`worker.ts`):** loads the same domain modules. `JobRunner` subscribes every `JobHandler` provider to its queue (retries with exponential backoff; payloads Zod-validated on send and on run) and registers the cron jobs:
  - `identity.purge-expired-unverified`, hourly at :15;
  - `platform.rate-limit-purge`, every 10 min.
- **Worker HTTP:** a small server on `WORKER_PORT` (default 4001) serves `/health`, `/ready` and `/metrics`.

### Observability (M0-T6)
- **Logs:** pino (nestjs-pino), JSON in prod and pretty in dev.
  - Every request gets `x-request-id` (a safe client value is kept; otherwise a uuid). The id is returned as a header, put in every log line as `requestId` and included in problem+json bodies.
  - Emails and E.164 phones are masked in messages and objects (`+91******3210`).
  - Auth headers, cookies, CSRF tokens, passwords and tokens are redacted.
  - Errors are logged without `message`, which can hold SQL params.
- **Traces:** OpenTelemetry (http + express) when `OTEL_EXPORTER_OTLP_ENDPOINT` is set; otherwise no SDK is loaded. Log lines carry `trace_id`/`span_id`.
- **Metrics:** Prometheus at `/metrics` (Bearer `METRICS_TOKEN`, which is required in prod). Covers HTTP duration by route template, job attempts and duration by queue, outbox published/errors, and Node defaults.
- **Probes:** `/health` is liveness and checks nothing. `/ready` checks the DB and the pgboss schema and returns 503 problem+json when one fails.
- **API docs:** `/docs` (Swagger UI) and `/docs/openapi.json`, outside production only. They are generated from the same Zod schemas that validate requests (`ZodBodyPipe`) plus `@ZodResponse`. Event types are versioned Zod schemas in `packages/shared/events`, e.g. `lead.created.v1`, `lead.stage_changed.v1`, `call.completed.v1`, `call.missed.v1`, `qualification.saved.v1`, `task.due.v1`.

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
- Local dev: no Docker, no cloud services; apps and a native PostgreSQL 18 run on the dev machine (ADR-012, docs/05-local-dev-setup.md).
- Docker images for web, api, worker, voice-agent are built in CI only (multi-stage Dockerfiles written in M8).
- Prod: managed Postgres in ap-south-1 (no Redis, ADR-011), containers on ECS/Fly/Render-style platform (decide in M8 ADR), S3 private bucket, LiveKit Cloud or self-hosted (S1 decides).
- Kubernetes, Kafka, ClickHouse, Temporal: explicitly deferred — see ADRs for revisit triggers.
