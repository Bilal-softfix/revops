# M8 — Production Readiness & Pilot Launch
**Depends on:** M7 · **Size:** M

## Tasks
**M8-T1 Hosting ADR + IaC** — choose platform (ADR-008), Terraform/Pulumi for Postgres (no Redis — ADR-011), S3, secrets, networking in ap-south-1; staging + production environments; CD pipeline with migrations step and manual prod approval.
**M8-T2 Security hardening** — full security-auditor pass on whole codebase, dependency audit, security headers/CSP, rate limits review, secrets rotation procedure, pen-test checklist (OWASP ASVS L1).
**M8-T3 Compliance features complete** — contact data export/erase, retention purge verified, consent records, DPA + privacy policy pages linked, sub-processor list.
**M8-T4 Reliability** — backups + tested restore (PITR), queue dead-letter handling + replay tool (pg-boss DLQ), pg-boss/rate-limit table bloat + autovacuum monitoring, alerting (error rate, webhook failures, call failures, queue lag, cost spikes), status page.
**M8-T5 Load test** — k6: lead ingest burst, dashboard load, 20 concurrent calls (with Fake media where needed + a smaller real test).
**M8-T6 Onboarding** — tenant setup wizard (industry template → team → number → routing → playbook → test call), product docs, runbooks (incident, telephony outage, provider token expiry).
**M8-T7 Pilot checklist** — design-partner tenant created, real number live, 1 week shadow mode (AI only after hours), feedback loop.

## Go/no-go (Dev)
- [ ] Restore from backup tested
- [ ] Security findings: zero CRITICAL/HIGH open
- [ ] Legal sign-off on consent/recording/AI disclosure
- [ ] 20+ real AI calls reviewed with acceptable quality
