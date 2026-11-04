# M3 — Telephony & Human-first Routing
**Depends on:** M2, S1 (ADR-007) · **Size:** L

## Goal
Inbound calls on tenant numbers ring the right humans first; unanswered or after-hours calls go to AI (stubbed until M4) or voicemail; every call is logged, recorded (with announcement) and linked to a lead.

## Tasks
**M3-T1 TelephonyProvider adapter** — interface (provisionNumber, handleInboundWebhook, ringGroup, bridge, transferToAgentRoom, hangup, getRecording) + real impl per ADR-007 + Fake impl that simulates answered/no-answer/busy/failed; contract tests.

**M3-T2 Numbers & routing rules** — attach provider numbers to tenant; routing rule CRUD (sequential/simultaneous, ring timeout, members, business hours, after-hours action, no-answer action, playbook); agent availability toggle (available/away) respected in ring groups.
- AC: rule evaluation is a pure function with exhaustive unit tests (hours, holidays, all-away, partial answers).

**M3-T3 Inbound call lifecycle** — webhook → call_session state machine (ringing → human_answered | ai_answered | missed | voicemail → completed/failed); contact/lead find-or-create (source=phone); recording announcement; `call.completed.v1` / `call.missed.v1` events; timeline entries.
- AC: state machine rejects invalid transitions; duplicate provider webhooks idempotent; out-of-order webhooks handled.

**M3-T4 Recordings** — fetch from provider to private S3, signed short-lived URLs, in-app player on timeline; retention purge job per tenant setting.

**M3-T5 Agent call UI** — live "incoming call" notification (SSE/WebSocket) with caller's lead card before answering (screen pop), call log page with filters, click-to-call callback (outbound to existing lead only, respects DND flag).
- AC: screen pop appears within 2s of ring in local test with Fake provider.

**M3-T6 Missed-call safety net** — if AI not yet enabled: missed call → task "Call back" assigned + optional WhatsApp "we missed your call" template (stub until M5).

**M3-T7 Usage** — write usage_events for call minutes and recording storage with cost rates from config.

## Kickoff prompt
```
/start-milestone M3
ADR-007 is decided — follow it. Everything must work end-to-end with the Fake provider in tests; the real provider is used only in a manual test checklist you will write in docs/runbooks/telephony-manual-test.md.
```

## Review checklist
- [ ] Real call test: human answers; human misses → fallback; after hours → fallback
- [ ] Recording announcement always plays when recording enabled
- [ ] Webhook signature verification for the provider
- [ ] Call minutes in usage_events match provider's dashboard for test calls
