# M2 — Lead Capture & Dedupe
**Depends on:** M1 · **Size:** M

## Goal
Leads arrive from web forms, a public API/webhook, CSV import and manual entry — deduplicated, attributed, and timestamped for response-time tracking.

## Tasks
**M2-T1 Lead sources** — CRUD sources of type web_form/api/csv/manual/phone/whatsapp/meta; each has a public key; active toggle.

**M2-T2 Public form endpoint + embed** — `POST /v1/public/forms/:publicKey` (no auth, CORS allow-list per source, rate limited, honeypot + optional Turnstile/hCaptcha), embeddable JS snippet that captures UTM params, gclid, fbclid, landing URL, referrer from the page/cookies; field mapping config per source.
- AC: snippet works on a plain HTML test page; attribution stored on lead; spam honeypot submissions dropped silently.

**M2-T3 Generic inbound webhook** — per-source signed webhook (HMAC secret) for Zapier/website backends; persists to `inbound_webhooks`, async processing, idempotent on external id.
- AC: replaying the same payload twice creates one lead; bad signature → 401 and stored as invalid.

**M2-T4 Dedupe engine** — match on phone E.164, then email; configurable policy per tenant: merge into existing open lead (append timeline "re-enquiry") or create new lead for same contact if previous is closed. Merge contacts manually (UI) with field-level pick.
- AC: test matrix of match/no-match/closed-lead cases; manual merge moves leads, notes, tasks, timeline and is audited.

**M2-T5 CSV import** — upload to S3, column mapping UI, preview first 20 rows, validation, background processing with progress, error report CSV download.
- AC: 10k-row file imports in background; partial failures reported per row; re-running same file doesn't duplicate.

**M2-T6 Assignment on arrival + response time** — default assignment strategy (round-robin among active agents / specific user / unassigned), emit `lead.created.v1`; `first_response_at` set on first outbound call/message/stage change by a human.
- AC: round-robin fair across 3 agents over 30 leads; first response timestamp correct.

## Kickoff prompt
```
/start-milestone M2
Treat all public endpoints as hostile input. Show me the threat considerations in your plan.
```

## Review checklist
- [ ] Public endpoints rate-limited and payload-size-limited
- [ ] Attribution fields preserved end to end (form → lead)
- [ ] Idempotency on webhook + import proven by tests

## Threat model (approved plan, 2026-11-17)
- Tenant resolved only from the source `public_key` via a SECURITY DEFINER lookup (active sources only; unknown/inactive → same 404). Everything after runs in `withTenant`.
- Rate limits per IP, per source and per tenant/day; body caps of 16 kB (form) and 64 kB (webhook); strict Zod with length caps.
- Honeypot returns a silent 200; optional captcha (Fake/Turnstile); per-source CORS allow-list; no cookies; CSRF exempt only for `/v1/public/*`.
- Webhook: HMAC-SHA256 over `timestamp.body`, ±5 min window, timing-safe compare, idempotent on external id, secret envelope-encrypted, never logged.
- Responses never reveal whether a contact exists. Attribution values are capped strings; URLs are http(s) only. Raw payloads are purged after 30 days.
- CSV: ≤10 MB / 50k rows, background, per-row idempotency, escaped error report, ANALYZE after ≥1k inserted rows.
