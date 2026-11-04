# 00 — Execution Plan

## Goal
Ship a production-ready MVP that lets a pilot Indian SMB **capture every lead, answer every call (human first, AI fallback), qualify and follow up automatically, and see which sources produce qualified leads** — with Meta Lead Ads attribution.

MVP = proposal's Stage 1 + Meta part of Stage 2. Google Ads, AI lead scoring, visual workflow builder, AI Growth Manager → post-MVP backlog.

## Fixed decisions
- Market: India (Asia/Kolkata default TZ, INR, E.164 +91, data in AWS ap-south-1 Mumbai)
- Segment: undecided → build **segment-agnostic**: custom fields, configurable pipeline stages, per-tenant qualification templates and AI agent "playbooks" stored as data. Seed 3 industry templates (real estate, education, clinics) as JSON, not code.
- Stack: lean modular monolith (see 01-architecture.md, ADRs in 04-decisions.md)

## Phase map

| Phase | Milestones | Size | Gate to pass |
|---|---|---|---|
| Foundation | M0 | M | CI green, auth + tenants + RBAC + RLS proven by tests |
| Sales core | M1, M2 | L | A lead from any source lands deduped in one CRM timeline |
| Voice (risk) | S1 spike → M3, M4 | XL | Real inbound call: rings human → AI picks up on timeout → summary in CRM |
| Automation | M5 | M | Event-driven follow-ups + WhatsApp templates working |
| Insight & cost | M6 | M | Dashboards + per-tenant usage/cost metering |
| Marketing | M7 | M | Meta lead → CRM with campaign/adset/ad attribution |
| Production | M8 | M | Security review, load test, backups, runbooks, pilot onboarding |

Sizes are relative (S < M < L < XL). Calendar estimates come after S1 and after the segment is picked.

## Dependency graph
```
M0 ─┬─ M1 ── M2 ──┬── M5 ── M6 ── M7 ── M8
    │             │
    └─ S1 (spike) ┴── M3 ── M4 ──┘
```
S1 runs in parallel with M1/M2 in a separate `spikes/voice` folder. Its outcome (ADR) decides M3's telephony design.

## Parallel non-code tracks (start NOW — these have the longest lead times)
| Track | Owner | Why it blocks |
|---|---|---|
| Meta Business Verification + App Review (`leads_retrieval`, `pages_manage_metadata`, etc.) | Dev | M7 can't go live without approved permissions |
| WhatsApp Business Platform: Cloud API number + display name + message template approvals | Dev | M5 real sending |
| Telephony provider account + KYC for Indian virtual numbers (Exotel / Plivo / others — S1 decides) | Dev | M3 real calls |
| DLT registration (entity + headers + templates) if SMS is used | Dev | SMS follow-ups |
| Legal review: DPDP Act + Rules, consent text, privacy policy, DPA template for customers | Dev + lawyer | Pilot onboarding (M8) |
| Customer discovery: 15–20 interviews across 3 candidate segments, pick 1, sign 3–5 design partners | Dev | Prioritisation from M5 onwards |
| Google Ads API developer token (apply early even though post-MVP) | Dev | Post-MVP |

## Session protocol (how every Claude Code session runs)
1. `/start-milestone Mx` → Claude reads specs, shows plan, asks questions → **you approve**.
2. `/implement-task Mx-Ty` per task → tests + DoD + commit.
3. Context full or long session? Ensure PROGRESS.md is updated → `/clear` → "Continue milestone Mx from PROGRESS.md".
4. `/review-milestone Mx` → reviewer + security subagents → fixes → report.
5. **Human checkpoint (you):** run the demo steps, skim the diff, merge to `main`, tag `mx-done`.

Branching: `main` protected; one branch per milestone `milestone/m1-crm-core`; squash or merge-commit at checkpoint. Never let Claude push — you push.

## Human checkpoints (mandatory stops)
- After M0: verify RLS leak tests actually fail when the policy is removed.
- After S1: decide telephony provider + voice stack from the spike report (write ADR).
- After M4: listen to 20 test calls (Hindi, English, Hinglish) before anything reaches a pilot.
- After M6: check per-call cost numbers against pricing assumptions.
- After M8: go/no-go for first pilot tenant.

## Prompting tips that get production-grade output
- Give Claude the milestone file, not a vague ask. If something isn't in a milestone file, add it there first.
- Reject plans that skip tests or touch too many modules at once; ask it to split.
- When output quality drops in a long session, it's context bloat — update PROGRESS.md and `/clear`.
- Ask "what could break this in production?" after each task touching webhooks, calls or money.
- Keep `docs/` truthful: if implementation diverges, update the doc in the same commit.
