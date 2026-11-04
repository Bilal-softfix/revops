# M6 — Reporting & Usage Metering
**Depends on:** M5 · **Size:** M

## Goal
Owners see lead and sales performance by source and team; the platform knows exactly what every tenant costs us.

## Tasks
**M6-T1 Metrics layer** — SQL views/materialized views refreshed by worker: leads by source/day, first-response time (median/p90), contact rate, missed-call rate, AI-handled share, qualification rate, appointment/callback rate, stage conversion funnel, won value by source.

**M6-T2 Dashboards** — owner dashboard (KPIs + trends + date range + compare period), source performance table, team table (per agent response time, calls, follow-up completion), funnel chart. All in tenant timezone.

**M6-T3 Usage & cost** — per-tenant monthly usage by type with ₹ cost; limits + alert thresholds (email/in-app); hard-stop option for AI minutes when cap reached (fallback to voicemail + task).

**M6-T4 Internal admin console** — (platform staff only, separate role) tenants list, usage/cost/margin per tenant, impersonation with audit, feature flags per tenant.

**M6-T5 Scheduled reports** — weekly email summary to owners.

## Review checklist
- [ ] Dashboard numbers reconcile with raw table counts (test with fixed seed)
- [ ] p95 dashboard load < 2s on 100k-lead seed
- [ ] Cost per tenant visible and matches provider invoices for test period
