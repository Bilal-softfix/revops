# PROGRESS

## Current
Milestone: M0 — Foundation (in progress). Branch: `milestone/m0-foundation`.
Plan approved 2026-11-04. Next: M0-T1 (waiting on Step 0 machine prerequisites: Node 22 via fnm, corepack/pnpm, uv).

## Done
_(none)_

## In progress
- [ ] M0-T1 Monorepo scaffold
- [ ] M0-T2 CI
- [ ] M0-T3 DB layer + tenancy core (needs Neon + Redis Cloud provisioned per docs/05-local-dev-setup.md)
- [ ] M0-T4 Auth
- [ ] M0-T5 RBAC + invitations
- [ ] M0-T6 Platform plumbing
- [ ] M0-T7 Web shell

## Assumptions made
_(Claude logs product assumptions here — Dev reviews at each checkpoint)_
- 2026-11-04 · M0: Node 22 LTS kept (machine also has Node 24; use fnm to switch).
- 2026-11-04 · M0: Dependency policy is the previous mature major when the newest major is < ~4 months old (TS 5.9, NestJS 11, Vitest 4, ESLint 9, BullMQ 5, ioredis 5, postgres.js 3, pnpm 10).
- 2026-11-04 · M0-T4: An unverified email blocks login (403 `email_not_verified` + resend endpoint).
- 2026-11-04 · M0-T5: A user who accepts an invite and has no account sets a name and password on the accept page and is created already verified, since the invite link proves the email.
- 2026-11-04 · M0-T5: In M0, a user can join extra tenants only through invites; there is no "create another tenant" flow yet.
- 2026-11-04 · M0-T4: Sessions are 30-day rolling with a 7-day idle timeout.
- 2026-11-04 · M0-T3: Seed creates one demo tenant with owner/admin/manager/agent users; the password comes from `SEED_PASSWORD`.
- 2026-11-04 · M0-T3: New env var `DATABASE_URL_TEST_OWNER` (owner role on the test DB, used to run migrations in Vitest globalSetup).
- 2026-11-04 · M0-T3: Cross-tenant reads (tenant switcher, invite lookup, outbox relay) go through narrow `SECURITY DEFINER` functions rather than a BYPASSRLS role.

## Blocked on external
- [ ] Meta Business Verification + App Review
- [ ] WhatsApp Cloud API number + templates
- [ ] Telephony provider KYC + numbers
- [ ] Legal review (DPDP, consent texts)
- [ ] Segment decision + design partners
- [ ] Neon (revops_dev, revops_test, app_user, extensions) + Redis Cloud (noeviction) provisioning — needed before M0-T3 integration tests

## Tech debt
_(non-blocking review findings)_
