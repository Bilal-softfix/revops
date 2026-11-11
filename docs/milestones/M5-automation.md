# M5 — Automation & Follow-up
**Depends on:** M2, M4 · **Size:** M

## Goal
Business rules react to events automatically: assignment, tasks, reminders, stage moves and permitted WhatsApp messages — reliably and idempotently.

## Tasks
**M5-T1 Rule engine** — rules = trigger event + condition tree (field comparisons on lead/contact/call/qualification) + ordered actions (assign, create_task, change_stage, send_whatsapp, notify_user, add_note, delay). Pure evaluator with unit tests; runs via outbox consumers; `automation_runs` unique(rule,event) for idempotency; loop protection (max depth, no self-trigger storms).

**M5-T2 Scheduled actions** — delays and reminders with pg-boss delayed jobs (survive restarts, ADR-011); cancel pending actions if condition no longer true at execution (e.g. lead already contacted).

**M5-T3 WhatsApp messaging** — MessagingProvider for WhatsApp Cloud API (+ Fake); template sync & approval status; send only if consent opt-in present; delivery/read status webhooks; inbound messages create/attach to lead + timeline; 24h session window enforced for free-form replies from the inbox.

**M5-T4 Unified inbox (basic)** — per-lead conversation view combining calls and WhatsApp; reply within window; template send outside window.

**M5-T5 Rule builder UI (form-based, not visual canvas)** — create/edit rules with dropdowns, test a rule against a sample lead (dry run), run history with errors.

**M5-T6 Starter recipes** — seeded rules per industry template: missed call → WhatsApp + callback task in 10 min; new lead uncontacted 15 min → notify manager; AI qualified hot → assign + task "call within 1 hour".

## Kickoff prompt
```
/start-milestone M5
Prioritise reliability: every action must be idempotent and retry-safe, and every failure visible in run history.
```

## Review checklist
- [ ] Worker restart mid-delay doesn't lose or duplicate actions
- [ ] No WhatsApp send without consent (test)
- [ ] Rule loops can't DoS the queue
