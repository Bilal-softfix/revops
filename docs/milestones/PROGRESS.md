# PROGRESS

## Current
Milestone: M0 — Foundation (in progress). Branch: `milestone/m0-foundation`.
Plan approved 2026-11-04. M0-T1, M0-T2 done 2026-11-04; M0-T3 done 2026-11-05. Next: M0-T4 Auth. Draft PR #1 open, CI green.

## Done
- [x] M0-T1 Monorepo scaffold (2026-11-04)
- [x] M0-T2 CI (2026-11-04) — green on GitHub (draft PR #1) after two fixes: build workspace deps before doctor, extensions in template1 for the CI owner
- [x] M0-T3 DB layer + tenancy core (2026-11-05): Drizzle schema + migrations, `withTenant`, `tenantRlsSql` generator, seed, test-DB strategy, leak suite + 2 meta-tests
- [x] M0 prep: `pnpm run db:bootstrap` — scripted Neon setup (DBs, extensions, app_user, env lines), since the Neon SQL editor isn't usable (2026-11-04)

## In progress
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
- 2026-11-04 · M0-T1: The doctor command is `pnpm run doctor`; plain `pnpm doctor` is a pnpm built-in that silently runs pnpm's own checker. CLAUDE.md, docs/05 and M0 AC were updated.
- 2026-11-04 · M0-T1: Env loading: root `.env` (shared DB/Redis) + `apps/<app>/.env` (app-specific); precedence real env > app > root. Env schemas live in `@revops/shared/env` (Node-only subpath).
- 2026-11-04 · M0-T1: Workspace packages (`shared`, `db`) are ESM compiled to `dist/` with tsc; `apps/api` is CommonJS and loads them via Node 22 `require(esm)`. Turbo runs `^build` before dev/typecheck/lint/test.
- 2026-11-04 · M0-T1: API dev runs plain `tsc --watch` + `node --watch` per entrypoint (scripts/dev.mjs); `@nestjs/cli` was not added (not needed).
- 2026-11-04 · M0-T1: Deps are added in the task that first uses them (pino, bullmq, argon2, etc. arrive in T3–T6), not all upfront.
- 2026-11-04 · M0-T1: Module boundary rule — `apps/api/src/modules/*` and `providers/*` may be imported by other modules only via their `index.ts` (eslint-plugin-boundaries, proven by test/eslint-boundaries.test.ts).
- 2026-11-04 · M0-T1: `.claude/settings.json` deny rules narrowed (with Dev approval) to explicit secret env file names so `.env.example` can be maintained.
- 2026-11-04 · M0-T2: `engines.node` kept at `>=22.12.0 <23` instead of the requested `>=22 <23`: 22.12 is the first Node with unflagged `require(esm)`, which apps/api needs. `pnpm run doctor` enforces the same floor.
- 2026-11-04 · M0-T2: CI = `checks` matrix (ubuntu: typecheck/lint/unit/build/audit; windows: typecheck/unit/build) + a separate ubuntu `integration` job, because service containers only run on Linux runners. Triggers: pull_request, push to main, manual.
- 2026-11-04 · M0-T2: CI integration DB mirrors Neon: non-superuser owner `revops_owner`, `app_user`, `revops_dev` + `revops_test`, extensions created by the container superuser. The doctor runs in CI against real Postgres/Redis.
- 2026-11-04 · M0-T2: `test:integration` turbo task exists but no package defines it yet; M0-T3 adds the first integration tests (single worker, `--concurrency=1`).
- 2026-11-04 · M0 prep: `db:bootstrap` reads `NEON_BOOTSTRAP_URL` (owner role) from the root `.env`, always does admin work on the direct endpoint, creates `app_user` last (so a failure never loses a generated password), and never prints the password of a pre-existing role. Added `--reset-app-password` (not requested) as the only recovery path without a SQL editor.
- 2026-11-04 · M0 prep: CI `revops_owner` now has CREATEDB + CREATEROLE, mirroring `neondb_owner`, so the bootstrap integration test runs against the CI Postgres. Locally it only runs with `RUN_BOOTSTRAP_INTEGRATION=1`.
- 2026-11-04 · M0 prep: `db:bootstrap --write-env` writes the 4 DATABASE_* keys into root `.env` and `apps/api/.env` and removes `NEON_BOOTSTRAP_URL`. Later runs fall back to `DATABASE_URL_OWNER` as the admin URL. For an existing `app_user` it reuses the password already in those files only after a successful login (auth errors 28P01/28000 = "doesn't work"; network errors are rethrown, never treated as a wrong password).
- 2026-11-04 · M0: `REDIS_URL` is optional until M0-T6 (schema `.optional()`, doctor ⚠ instead of ✖, `.env.example` blank). T3–T5 must not need Redis. **T6 makes it required again.**
- 2026-11-04 · Repo: `.claude/settings.json` allows `git push origin milestone/*` and read-only `gh pr`/`gh run` commands; pushes to `main`, force/delete/mirror pushes and `gh pr merge` stay denied.
- 2026-11-05 · M0-T3: `users` is global with no RLS (no tenant_id; login needs an email lookup before tenant context). Cross-tenant exposure of user rows is prevented in the repository layer, not by the DB. **Review:** decide whether T4 should add a users policy (visible only via a membership in the current tenant, plus SECURITY DEFINER login lookup).
- 2026-11-05 · M0-T3: RLS predicate is `nullif(current_setting('app.tenant_id', true), '')::uuid` — outside withTenant a query returns no rows (fail closed) rather than erroring; on a pooled connection the setting reads back as '' after a transaction-local value ends.
- 2026-11-05 · M0-T3: Policies are `TO PUBLIC` with FORCE RLS, so the owner (migrations, seed) is also bound by them. Grants are explicit per table (no default privileges). `audit_logs` is append-only for app_user (SELECT, INSERT); `tenants` has no DELETE for app_user.
- 2026-11-05 · M0-T3: `tenants` RLS keys on `id` (a tenant row is visible only in its own context). Seed uses a fixed demo tenant id so reruns need no cross-tenant lookup.
- 2026-11-05 · M0-T3: Leak suite (packages/db/test) checks, per tenant table and in both directions: read by id, read-all, update, update-moving-to-other-tenant, delete, insert-for-other-tenant, plus own-row access. Meta-tests: (1) catalog — every table with tenant_id (+ tenants) has ENABLE+FORCE RLS and exactly one `tenant_isolation` ALL policy, and is registered in the suite; (2) probe — the same checker passes a table with the generated SQL and reports violations once its policy is dropped / RLS disabled. Verified manually 2026-11-05: dropping the memberships policy on revops_test makes both the catalog test and the leak suite fail (exit 1).
- 2026-11-05 · M0-T3: Sessions, auth tokens and invitations tables move to T4/T5 (first use); SECURITY DEFINER functions for cross-tenant reads (tenant switcher, invite lookup, outbox relay) arrive with T5/T6.
- 2026-11-05 · M0-T3: Dependency added: `@node-rs/argon2` 2.2.2 in packages/db for seeding argon2id password hashes (prebuilt binaries, no node-gyp); T4 reuses it for login.
- 2026-11-05 · M0-T3: Neon project runs **PostgreSQL 18.6**; CLAUDE.md/CI target 16. SQL is kept 16-compatible (CI enforces). **Review:** recreate the Neon project on 16, or record an ADR moving the stack to 18.
- 2026-11-05 · M0-T3: Root `pnpm db:*` scripts build workspace deps first (like doctor), so they work on a fresh clone.
- 2026-11-04 · M0-T3: Cross-tenant reads (tenant switcher, invite lookup, outbox relay) go through narrow `SECURITY DEFINER` functions rather than a BYPASSRLS role.

## Blocked on external
- [ ] Meta Business Verification + App Review
- [ ] WhatsApp Cloud API number + templates
- [ ] Telephony provider KYC + numbers
- [ ] Legal review (DPDP, consent texts)
- [ ] Segment decision + design partners
- [ ] Redis Cloud (noeviction) — needed before M0-T6
- [ ] Dev: add `SEED_PASSWORD` (≥ 12 chars) to root .env, then `pnpm db:seed` (dev DB is migrated; seed not yet run)

## Tech debt
_(non-blocking review findings)_
- ESLint 9 is marked deprecated on npm. Blocked on ESLint 10: eslint-config-next 16.4.5 pulls eslint-plugin-react / -import / -jsx-a11y whose peer ranges stop at ESLint 9. Revisit when they support 10.
- drizzle-kit 0.31 pulls deprecated `@esbuild-kit/*` (transitive). Goes away with drizzle-kit 1.0 (currently RC).
- Dev to do: in GitHub branch protection for `main`, mark `checks (ubuntu-latest)`, `checks (windows-latest)` and `integration (ubuntu-latest)` as required checks.
- Docker images in CI are tag-pinned (`pgvector/pgvector:pg16`, `redis:7`), not digest-pinned; pin digests in M8 if reproducibility matters.
- `db:bootstrap` sends the app_user password to Postgres as a plain-text literal over TLS (Neon checks password entropy, so a pre-hashed SCRAM verifier may be rejected). Revisit if server-side statement logging is ever enabled.
- Turbo `envMode: loose` + `test` uncached: simple and correct for now; tighten env declarations if CI time matters.
