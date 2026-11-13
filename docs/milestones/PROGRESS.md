# PROGRESS

## Current
Milestone: M1 — CRM Core (starting). Branch: `milestone/m1-crm-core` (from main after M0 merged, tag `m0-done`).
M1-T0 (M0 follow-ups) done 2026-11-12. M1 plan approved 2026-11-12 (order: T3a → T1 → T2 → T3b → T4 → T5 → T6 → T7, sequential). Draft PR #2 open, CI green.

M0 history:
Plan approved 2026-11-04. M0-T1, M0-T2 done 2026-11-04; M0-T3, M0-T4 done 2026-11-05; M0-T5 done 2026-11-11. 2026-11-11: switched to local-first (ADR-011 no Redis/pg-boss, ADR-012 native Postgres). M0-T6, M0-T7 done 2026-11-11. M0 milestone review done 2026-11-12: blockers fixed, PR ready for review. Next: Dev merges PR #1 → start M1 (`/start-milestone M1`). PR #1 merged 2026-11-12 (tag `m0-done`).

## Done
- [x] M0-T1 Monorepo scaffold (2026-11-04)
- [x] M0-T2 CI (2026-11-04) — green on GitHub (draft PR #1) after two fixes: build workspace deps before doctor, extensions in template1 for the CI owner
- [x] M0-T3 DB layer + tenancy core (2026-11-05): Drizzle schema + migrations, `withTenant`, `tenantRlsSql` generator, seed, test-DB strategy, leak suite + 2 meta-tests
- [x] M0-T4 Auth (2026-11-05): signup/verify/login/logout/me/forgot/reset under /v1/auth, opaque `__Host-sid` sessions, CSRF, argon2id, rate limits, users/sessions/auth_tokens RLS + 3 SECURITY DEFINER lookups, security review fixes (migration 0004)
- [x] M0-T5 RBAC + invitations (2026-11-11): permission map + `@RequirePermission`, members list/role/disable with last-owner lock, invitations (create/list/resend/revoke/accept), tenant switcher; role × route matrix + invitation leak tests
- [x] M0 prep: `pnpm run db:bootstrap` — scripted Neon setup (DBs, extensions, app_user, env lines), since the Neon SQL editor isn't usable (2026-11-04)
- [x] M0 local-first switch (2026-11-11): Redis removed (ADR-011: pg-boss for jobs from T6, Postgres rate limiter now via `rate_limit_buckets` + definer functions, migrations 0009/0010); native PostgreSQL 18 for dev/test (ADR-012: `DB_BOOTSTRAP_URL`, superuser mode creates `revops_owner`, verify-only reruns, `sslmode=disable` for localhost, pgvector optional until M4); second demo tenant in the seed

- [x] M0-T6 Platform plumbing (2026-11-11). Delivered:
  - pg-boss 12.38.0 behind `JobQueue`/`JobHandler`/`JobRunner`, schema installed by migration 0013;
  - outbox relay with `outbox_claim_batch`/`outbox_mark_published` (0012), `processed_events` + `processOnce`, and the demo consumer;
  - auth/invitation background work moved to jobs, with no secrets in job rows;
  - cron jobs for the unverified-account and rate-limit purges;
  - pino with request ids, PII masking and redaction; OTel tracing (opt-in); Prometheus `/metrics`; `/health` + `/ready`; OpenAPI at `/docs` from the Zod schemas;
  - a worker HTTP server; `requestId` in problem+json.
  - **AC test:** `apps/api/test/outbox.int.test.ts` (relay run twice and concurrently, real pg-boss worker, applied exactly once).

- [x] M0-T7 Web shell (2026-11-11):
  - auth pages: login, signup + resend, verify-email with password and "This wasn't me", forgot/reset, accept-invite (new user / signed in / login required / wrong user);
  - app shell: sidebar with role-based nav, tenant switcher, user menu; Settings → Team (members with cursor paging, invite, change role, disable/re-enable, resend/revoke invitations); loading/empty/error states throughout;
  - same-origin `/api` proxy; the API gains `EMAIL_DRIVER=file` and `TRUST_PROXY`;
  - consumers now skip events whose tenant was deleted;
  - tests: Playwright e2e (6 tests), web unit tests (25), CI `e2e` job.

- [x] M0 milestone review (2026-11-12). Fixed:
  - reset-password per-IP limit before argon2;
  - per-account login and email limits independent of the (spoofable) IP;
  - per-IP limits on resend/forgot before enqueue;
  - member cursor validated as a uuid (400, not 500);
  - an admin can no longer reactivate a disabled owner by re-inviting them;
  - names reject control characters;
  - open redirect via `?next=/%09/…`;
  - web proxy body capped at 100 kB (streamed);
  - web security headers (no framing, nosniff, referrer policy, HSTS);
  - failed-job errors stored without the message;
  - worker shutdown stops pg-boss and the relay before closing the DB pool;
  - job retries no longer consume the user's email allowance.

- [x] M1-T0 M0 follow-ups (2026-11-12):
  - **Signup squatting:** when the replace cap blocks a signup, the inbox owner still gets a start-over link (within the per-address email limit). A start-over through such a link (`auth_cancel_signup`, migration 0016) resets that email's replace allowance.
  - **Shared writer:** `recordEvent` / `recordAudit` validate against the shared event registry; repository copies removed; outbox CHECKs added.
  - **Relay:** dead-letters bad rows (migrations 0014/0015) instead of blocking every tenant.
  - **Expired invitations:** no longer pending; re-inviting supersedes them (revoked + `invitation.superseded` audit).

- [x] M1-T3a Industry templates + CRM provisioning (2026-11-12):
  - six template JSONs (incl. software-agency and repair-shop with two pipelines), validated by Zod;
  - tables `pipelines`, `pipeline_stages`, `custom_field_defs`, `lead_sources` (FORCE RLS, composite tenant FKs; migrations 0017/0018);
  - `provisionCrm` (idempotent, advisory lock) at signup via the new "Business type" picker, and lazily for older tenants;
  - `GET /v1/pipelines` and `GET /v1/lead-sources` (`lead.read.assigned`, all roles);
  - permissions `lead.read.assigned` / `lead.read.all` added.

- [x] M1-T1 Contacts (2026-11-13):
  - E.164 normalisation (14 formats tested) and phone/email uniqueness per tenant with a visibility-aware 409;
  - trigram search, cursor paging, soft delete;
  - per-tenant `agentContactVisibility` (all | assigned; template defaults; `GET`/`PATCH /v1/crm/settings`, owner/admin);
  - web: Contacts list, search, create dialog with phone preview, detail/edit/delete; seed sets Demo Realty = assigned, Demo Clinic = all;
  - `contact.created.v1` event; audit rows store field names only;
  - migrations 0019/0020.

## In progress
- [ ] M1-T2 Custom fields (defs CRUD, validation, dynamic form inputs)
- [ ] M1-T3b Pipelines & stages (CRUD, reorder, delete-with-move)
- [ ] M1-T4 Leads (list/filters/saved views, kanban, stage change + events, agent visibility)
- [ ] M1-T5 Notes, tasks, timeline (My tasks)
- [ ] M1-T6 Audit + bulk actions + CSV export
- [ ] M1-T7 Seed (4 demo tenants incl. Demo Software Agency + Demo Repair Shop), 10k-lead volume check, Playwright

## Assumptions made
_(Claude logs product assumptions here — Dev reviews at each checkpoint)_
- 2026-11-04 · M0: Node 22 LTS kept (machine also has Node 24; use fnm to switch).
- 2026-11-04 · M0: Dependency policy is the previous mature major when the newest major is < ~4 months old (TS 5.9, NestJS 11, Vitest 4, ESLint 9, postgres.js 3, pnpm 10; BullMQ/ioredis dropped by ADR-011).
- 2026-11-04 · M0-T4: An unverified email blocks login (403 `email_not_verified` + resend endpoint). **Superseded 2026-11-06** by the security review: same 401 as a wrong password (confirmed by Dev 2026-11-11).
- 2026-11-04 · M0-T5: A user who accepts an invite and has no account sets a name and password on the accept page and is created already verified, since the invite link proves the email.
- 2026-11-04 · M0-T5: In M0, a user can join extra tenants only through invites; there is no "create another tenant" flow yet.
- 2026-11-04 · M0-T4: Sessions are 30-day rolling with a 7-day idle timeout.
- 2026-11-04 · M0-T3: Seed creates one demo tenant with owner/admin/manager/agent users; the password comes from `SEED_PASSWORD`. **Extended 2026-11-11 (Dev):** second tenant Demo Clinic (`demo-clinic`) with `owner2@` + `agent2@demo.revops.test`; `manager@demo.revops.test` is a manager in both tenants.
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
- 2026-11-04 · M0: `REDIS_URL` is optional until M0-T6. **Superseded 2026-11-11:** Redis is removed entirely (ADR-011); `REDIS_URL`, ioredis and the CI Redis service are gone.
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
- 2026-11-05 · Stack: PostgreSQL 18 everywhere (ADR-010); CI on `pgvector/pgvector:0.8.6-pg18`; doctor requires ≥ 18. Verify managed PG18 + pgvector in ap-south-1 at M8.
- 2026-11-05 · M0-T4: `users` RLS = self (app.user_id) or a member of the current tenant; insert/update self only, no delete. Column grants: app_user can't read `password_hash` or update `id`/`email` (0004). `sessions`/`auth_tokens`: own rows only. These user-scoped tables are RLS ENABLED but not FORCED so owner-owned SECURITY DEFINER lookups (`auth_find_user_by_email`, `auth_session_lookup`, `auth_consume_token`; fixed search_path, EXECUTE for app_user only) can read them; tenant tables stay FORCED.
- 2026-11-05 · M0-T4: User-only context (app.user_id set, no tenant): read-only `self_select` policies on memberships/tenants show the user its own *active* memberships of *active* tenants (login tenant choice, T5 switcher). Chosen instead of a SECURITY DEFINER `my_tenants()` because memberships/tenants are FORCED (an owner-run definer would see nothing).
- 2026-11-05 · M0-T4: `withContext(db, {tenantId, userId}, fn)` replaces direct `withTenant` use for auth work; both settings are always set ('' when absent).
- 2026-11-05 · M0-T4: Sessions: 30-day absolute expiry (SQL) + 7-day rolling idle timeout (app, last_seen_at touched at most every 5 min). Cookie `__Host-sid` (httpOnly, Secure, SameSite=Lax, Path=/); plain `sid` only if COOKIE_SECURE=false. Active membership + role re-checked on every request.
- 2026-11-05 · M0-T4: CSRF token = HMAC(session token, "csrf.v1"), returned by login/me, required as `x-csrf-token` on unsafe authenticated routes. JSON-only body parsing (urlencoded disabled) blocks cross-site form posts incl. login CSRF.
- 2026-11-05 · M0-T4: Passwords: argon2id (library defaults), 12–128 chars. Verify links 24 h, reset links 1 h, single use. Reset sets the password, marks the email verified, revokes all sessions, expires other reset links. Login with unknown email does a dummy argon2 verify (timing).
- 2026-11-05 · M0-T4: Rate limits (in-memory until T6): login 5 attempts/(IP, email)/15 min reserved atomically before verify, cleared on success, + 50/IP/15 min; signup 10/IP/h; verify/reset emails 3/(IP, email)/h + 20/IP/h, extra requests dropped silently (still 202).
- 2026-11-05 · M0-T4 follow-up (Dev decision a): signup always returns `202 {"status":"check_email"}`. An existing verified email gets a "you already have an account" email and nothing is created.
- 2026-11-05 · M0-T4 follow-up (Dev decision b): (1) verify-email needs the token and the account password; a bad link, used link, expired account and wrong password all return 400 `verification_failed` after one argon2 verify; 5 attempts per account plus 50 per IP per 15 min. Added `POST /v1/auth/verify-email/cancel {token}` ("this wasn't me"), which deletes the unverified account and its sole-owned tenant. (2) A signup for an unverified email replaces the pending account: it is deleted, a new one is created, and old links and the old password die. (3) Unverified accounts expire 48 h after signup (`auth_unverified_cutoff()` in SQL); login, verify, resend and forgot treat them as non-existent; `UnverifiedAccountCleanupJob` purges them and T6 schedules it hourly. (4) Reset revokes every session of the user, tested with 3 sessions plus a DB check.
- 2026-11-05 · M0-T4 follow-up: all account-state work for signup, resend and forgot runs as a `BackgroundTasks` task after the 202. **Done in T6:** these are pg-boss jobs now (durable, retried). Tests use a queued implementation to prove nothing state-dependent runs before the response.
- 2026-11-05 · M0-T4 follow-up: "Replace" means delete and recreate: the pending account gets a new user id and tenant, and the audit/outbox rows of the discarded tenant are deleted with it (it was never activated).
- 2026-11-05 · M0-T4 follow-up: verify-email now also expires the user's other unused verify links.
- 2026-11-06 · M0-T4 security review of the follow-up (security-auditor), all fixed in migration 0006 + API:
  - Race: a discard could delete a just-verified account. The discard now locks the user row and re-checks "unverified" under that lock, then locks each tenant. Verify and reset are each one atomic definer call (`auth_verify_email`, `auth_reset_password`), and `auth_consume_token` is dropped. Purge runs per account, each in its own subtransaction.
  - Oracle: signup + login revealed whether a verified account existed. **Unverified login now returns the same 401 `invalid_credentials` as a wrong password** (and re-sends the verify email in the background); `email_not_verified` is removed. This changes the M0 assumption "unverified email → 403": an unverified email still blocks login, it just isn't distinguishable.
  - Replace abuse: at most 3 replaces per email per day (any IP), discards are logged with a masked email + IP, and forgot-password on an unverified account sends a verify ("this wasn't me") email instead of a reset link.
  - Logs: 500s and background-task failures log `safeErrorSummary` (class, SQLSTATE, stack), never `.message`, because drizzle puts query params (emails, password hashes) in the message.
  - `verify-email/cancel` is rate-limited per IP (20 per 15 min) and logged. The dummy argon2 hash is precomputed at startup.
  - Invariant documented in 0006: an unverified user has only its signup owner membership (invites create verified users in T5).
- 2026-11-05 · M0-T4: Minimal RFC 7807 filter + body-parser error mapping added now (needed for auth errors); T6 adds request ids, pino and logging. Emails are sent after the response (fire-and-forget); T6 moves them to the outbox.
- 2026-11-05 · M0-T4: Audit logs: `user.signed_up`, `auth.login`, `auth.logout` (in the active tenant). Password reset has no tenant, so it isn't audited yet.
- 2026-11-05 · M0-T4: API is `AppModule.register(env)`; env is validated once and injected (`API_ENV`). API refuses to start in production with EMAIL_DRIVER console/fake, a non-https/localhost APP_URL, or COOKIE_SECURE=false.
- 2026-11-05 · M0-T4: Security review (security-auditor) fixed now: concurrent-burst login bypass, membership not re-checked after login, no per-IP limits, reset-email blocking, timing of 202 endpoints (email off the request path), console email in prod, password_hash readable to co-members, self_select ignoring status, cookie tossing (`__Host-`), slug collision reported as email_taken (now retried), malformed JSON/413 as problem+json. Both review decisions (a) signup enumeration and (b) pre-account hijack were resolved in the T4 follow-up (see above).
- 2026-11-04 · M0-T3: Cross-tenant reads (tenant switcher, invite lookup, outbox relay) go through narrow `SECURITY DEFINER` functions rather than a BYPASSRLS role.

- 2026-11-11 · M0-T5 (Dev decisions): only owners and admins invite. Owners can grant any role; admins can grant admin/manager/agent but never owner. Changing roles and disabling/re-enabling follows the same rule, so admins never touch owners. The last active owner can't be demoted or disabled, and nobody can disable themselves.
- 2026-11-11 · M0-T5 (Dev decision): an invitation for an email with a verified account is accepted only while signed in as that email; this adds the membership and switches the session to the tenant. For new emails, name + password create a verified account; a pending unverified account for that email is replaced.
- 2026-11-11 · M0-T5 (Dev decision): invitations are single-use and last 7 days; inviters can list, resend (which rotates the link) and revoke them; one open invitation per email per tenant.
- 2026-11-11 · M0-T5: `member.read` is granted to every role (agents can see their teammates). M0 permissions: member.read / member.invite / member.manage. Later milestones add lead.*, routing.* and so on to `ROLE_PERMISSIONS`.
- 2026-11-11 · M0-T5: The invitation token is `<tenant_id>.<random>`. The tenant part isn't secret; it lets accept look the hashed token up in that tenant's RLS context, so invitations stay FORCE RLS with no definer function. A disabled member can be re-invited; accepting re-activates them with the invited role.
- 2026-11-11 · M0-T5: Members list uses cursor pagination; the cursor is the last membership id, compared against exact DB values (JS Dates lose microseconds). Max page size is 100.
- 2026-11-11 · M0-T5: Rate limits: 100 invitation emails per tenant per day (create + resend); invitation accepts 20 per IP per 15 min.
- 2026-11-11 · M0-T5: Audit log actions: invitation.created/resent/revoked, member.joined (plus a `member.joined.v1` outbox event), member.role_changed/disabled/enabled with before/after.
- 2026-11-11 · Local-first (Dev decision): no Redis in dev/CI/prod — pg-boss (12.38.0, added in T6 where first used) behind our own queue interface; rate limits in Postgres. ADR-011 supersedes ADR-002.
- 2026-11-11 · Local-first (Dev decision): dev/test on a native PostgreSQL 18 (Windows installer, port 5432). `NEON_BOOTSTRAP_URL` → `DB_BOOTSTRAP_URL` (the old name is rejected with a rename hint). Neon support kept but unused. ADR-012 amends ADR-009.
- 2026-11-11 · db:bootstrap with a superuser creates a dedicated NOSUPERUSER `revops_owner` that owns the DBs and runs migrations. Reason: if the owner were `postgres`, the SECURITY DEFINER functions would run as a superuser and bypass RLS, unlike Neon/CI. Doctor warns if `DATABASE_URL_OWNER` is a superuser.
- 2026-11-11 · db:bootstrap after `--write-env` deletes `DB_BOOTSTRAP_URL` (the superuser password doesn't stay on disk); reruns connect as `revops_owner` in verify-only mode (create nothing, check everything, reuse passwords proven by login).
- 2026-11-11 · pgvector is optional (doctor ⚠, bootstrap warns) until M4; CI keeps `pgvector/pgvector:0.8.6-pg18`.
- 2026-11-13 · M1-T1 follow-up (Dev):
  - a contact needs a phone OR an email (create: 400 on the phone field if neither; PATCH can clear one but not both); dedupe on whichever is present. This replaces the T1 assumption "a contact needs a phone";
  - `pnpm db:reset:dev` added (guarded dev-only reset + migrate + seed).
- 2026-11-13 · M1-T1 (Dev decisions):
  - agent contact visibility is a per-tenant setting, defaulting from the template (repair-shop/clinic = all; others = assigned);
  - in `assigned` mode agents also see contacts they created;
  - a duplicate's `ownerName` is the owner of the contact's latest lead (creator until M1-T4 adds leads).
- 2026-11-13 · M1-T1 assumptions:
  - email is unique per tenant too, as the Dev request said "duplicate phone/email";
  - contact audit rows record changed field names, not values (no second copy of PII);
  - tenants seeded or provisioned before M1-T1 have no stored setting and read their template's default;
  - permissions: `contact.write` all roles, `contact.delete` owner/admin/manager, `crm.settings.manage` owner/admin.
- 2026-11-12 · M1-T3a:
  - templates live in `packages/shared/src/templates/data/` (not `packages/shared/templates/`), so tsc ships them in `dist` and the web bundle can import them;
  - lost-reason presets are per pipeline (repair cancellations differ from inquiry losses);
  - custom field keys are never reusable, even after deletion;
  - template option values may start with a digit (`1bhk`).
- 2026-11-12 · M1 plan (Dev decisions):
  - industry template picked at signup ("Business type", default `generic`), with lazy provisioning for existing tenants;
  - templates may define several pipelines; repair-shop has "Inquiries" + "Repair jobs" (a repair job = a lead in that pipeline, device details as custom fields);
  - `pipeline.manage` / `customfield.manage`: owner + admin; `lead.read.all` / assign / delete / bulk / export: owner + admin + manager;
  - agents see only contacts linked to their leads or created by them;
  - a lost reason is required when a lead enters a lost stage.
- 2026-11-12 · M1 assumptions (Review):
  - a lead always has exactly one contact (a new phone creates it in the same transaction; an existing phone links to it);
  - agent-created leads are owned by the agent, and only `lead.assign` roles reassign;
  - unassigned leads are visible only to read-all roles;
  - seed tenants use generic names (Demo Software Agency / Demo Repair Shop), not the real company names;
  - templates are applied once at provisioning, and later template edits don't migrate existing tenants.
- 2026-11-12 · M1-T0 (Dev decision: options 1 + 3, not 2): a refused replace emails a start-over link (a fresh verify token for the pending account), and a successful start-over resets `signup-replace:<email>`. Any successful cancel resets it, because verify/start-over links are only ever emailed to that address, so a cancel proves inbox ownership. The old `auth_discard_unverified_by_token` function stays, unused.
- 2026-11-12 · M1-T0: an unknown event type is now dead-lettered (it was "published with no consumers"): every event must be registered in `packages/shared/src/events/registry.ts`.
- 2026-11-12 · M1-T0: an expired invitation is superseded (revoked) when the same email is re-invited, since the open-email unique index has no notion of time. Resending an expired invitation by id still works and gives it a fresh 7-day expiry. The pending list stays unpaginated (small per tenant); paginate when needed.
- 2026-11-11 · M0-T7: the web never calls the API from the browser directly. A Next route handler proxies `/api/v1/*` → `API_INTERNAL_URL` (a runtime setting, not baked into the build by a next.config rewrite). Only `/v1` is exposed.
- 2026-11-11 · M0-T7: "restricted nav" today means:
  - every role sees Dashboard + Team, because all four roles have `member.read` (the T5 permission map);
  - managers and agents get the Team page read-only: no invite button, no pending invitations, no role or disable controls.
  - Nav items are permission-tagged data, so M1+ items (leads etc.) hide automatically.
  - **Review:** should agents see the Team page at all?
- 2026-11-11 · M0-T7: dates show in Asia/Kolkata (tenants have no timezone setting yet). UI is light-only (no theme switcher), uses the system font stack (no next/font/google download) and the shadcn radix-nova style.
- 2026-11-11 · M0-T7: e2e runs against revops_test (truncated by its global setup, like the integration suite), with the API's new `EMAIL_DRIVER=file` (dev/test only, rejected in production) so Playwright can read links the worker emails.
- 2026-11-11 · M0-T7 deps (web): @tanstack/react-query 5.105.0, react-hook-form 7.91.0, @hookform/resolvers 5.9.2 (v6/v7 are < 1 month old), radix-ui 1.8.1, class-variance-authority 0.7.1, clsx 2.1.1, tailwind-merge 3.7.0, lucide-react 1.62.0, sonner 2.0.8. Dev: @playwright/test 1.64.1, shadcn 4.23.0 (its CSS only), tw-animate-css 1.4.0, vitest. Not taken from the shadcn CLI: `cn` (a 0.x package; clsx + tailwind-merge do the same) and `next-themes` (no theme switching).
- 2026-11-11 · M0-T7 fix (API): a consumer job whose tenant was deleted (e.g. a discarded unverified signup) used to fail on the processed_events FK and retry until its limit. `processOnce` now skips it; there is a test.
- 2026-11-11 · M0-T6: background work in jobs.
  - The signup password is now hashed on the request path, once per request whatever the account state (timing stays state-independent), so the job row holds only the argon2 hash.
  - Invitation create/resend stores the hash of a never-revealed placeholder token. The `tenancy.invitation-email` job mints and emails the real link, keeping the expiry. A retry or resend re-mints it, so only the newest emailed link works. A revoked, accepted or expired invitation gets no email.
  - Invitation jobs are enqueued in the same transaction as the invitation.
- 2026-11-11 · M0-T6: worker env = API env + `WORKER_PORT` (4001) + `OUTBOX_POLL_INTERVAL_MS` (1000), and the production env checks also apply to the worker. New common vars: `OTEL_EXPORTER_OTLP_ENDPOINT` (tracing off when empty) and `METRICS_TOKEN` (≥16 chars, required in production).
- 2026-11-11 · M0-T6: problem+json bodies now include `requestId`. The auth timing-safety tests compare responses without it, since it is a fresh uuid every time and depends on no account state.
- 2026-11-11 · M0-T6: OpenAPI comes from Nest's route scan, enriched from each route's `ZodBodyPipe` (body/query/path) and `@ZodResponse`. `@anatine/zod-openapi` and nestjs-zod were not added, so there are no DTO classes. `/health`, `/ready` and `/metrics` are excluded.
- 2026-11-11 · M0-T6 deps: pg-boss 12.38.0, nestjs-pino 4.6.1, pino 9.14.0, pino-http 10.5.0, pino-pretty 13.2.0 (dev), prom-client 15.1.3, @nestjs/swagger 11.4.8, @opentelemetry/{api 1.10.0, sdk-node 0.300.0, exporter-trace-otlp-http 0.300.0, instrumentation-http 0.300.0, instrumentation-express 0.72.0}. These were picked as Nest-11 compatible and ≥2 weeks old; the http/express instrumentations replace the heavy auto-instrumentations bundle. The pnpm override `multer: 2.5.0` fixes the high advisory GHSA-q7qp-rjg7-q26m (via @nestjs/platform-express). `@scarf/scarf` and protobufjs install scripts are ignored.
- 2026-11-11 · Rate limiter: `rate_limit_buckets` stores sha256(key) only (no IPs/emails), RLS enabled with no policies and no grants, reached via `rate_limit_consume/reset/purge` (definer). The app passes its Clock's now, so FakeClock tests keep working. RLS catalog meta-test gains a "system tables" class. Purge is scheduled in T6.

## Blocked on external
- [ ] Meta Business Verification + App Review
- [ ] WhatsApp Cloud API number + templates
- [ ] Telephony provider KYC + numbers
- [ ] Legal review (DPDP, consent texts)
- [ ] Segment decision + design partners
- [ ] Dev: install pgvector on the local Postgres 18 before M4 (optional until then)

## Tech debt
_M0 milestone review (2026-11-12): non-blocking findings from the code-reviewer and security-auditor subagents. The blockers were fixed in the review commit._
- **Signup squatting (residual after M1-T0).** A fast attacker can re-squat right after the owner's start-over, but the reset allowance (3 replaces) lets the owner's next signup win, and every refusal emails the owner. The per-address email limit (5/h) can delay the owner by up to an hour under a sustained attack.
- **Login per-IP counts successes (security MEDIUM-6).** `login-ip` (50 per 15 min) also counts successful logins, so 50+ people behind one CGNAT or office IP get 429 at 9am. Count failures only (needs a peek or decrement in the limiter) and tune the ceilings with real traffic.
- **Per-account lockout is now possible by design:** 20 wrong passwords lock that email out for 15 minutes (`login-email`). This is the standard trade-off against unlimited guessing; revisit with notification-on-trip or CAPTCHA.
- **Dead-lettered outbox events** need an operator view or replay tool (M6/M8); for now they are found via the metric, the logs and `select … where dead_lettered_at is not null`.
- **No-env production run fails open (security L2).** `NODE_ENV` defaults to `development`, so a prod deploy that forgets it gets `/docs`, open `/metrics` and the console email driver (live reset links in logs). M8: require NODE_ENV explicitly outside local dev.
- **Session and token retention (security L6).** Revoked or expired `sessions` (with IP and user agent) and used `auth_tokens` rows are never purged. Add a purge cron next to the rate-limit purge (DPDP).
- **API and worker bind 0.0.0.0 (security L7).** In dev, `/metrics` and `/docs` are reachable from the LAN. Bind to 127.0.0.1 by default, or require `METRICS_TOKEN` when bound to a non-loopback address.
- Published `outbox_events` and `processed_events` rows are never purged. Add a retention job when volumes matter (M6/M8).
- The minimatch moderate advisory (transitive) is still reported by `pnpm audit`; it is dev-tooling only.
- Worker jobs have no per-job log context (the job id is in the failure log only); add an AsyncLocalStorage child logger when consumers multiply.
- `InMemoryJobQueue` is not transactional: a job sent with `tx` stays queued in tests even if the transaction rolls back. Real pg-boss behaviour is covered by `test/queue.int.test.ts`.
_(non-blocking review findings)_
- M8: set `TRUST_PROXY` (M0-T7, default `loopback`) to the real hop count / proxy CIDRs before deploying behind a load balancer. Note: Next.js keeps a client-supplied `X-Forwarded-For` instead of appending to it, so behind the web proxy a client can choose the IP the API sees (rate-limit evasion per IP). Since the M0 review, per-account keys that ignore the IP bound the damage: `login-email` (20 per 15 min) and `email-<kind>-addr` (5 per hour). Still open: a spoofed IP can lock out a real shared IP (50 logins per 15 min), and per-IP ceilings are evadable. M8 must put a trusted LB in front that overwrites XFF, or have the web proxy set it from the socket address.
- M0-T6: discarding an unverified account deletes its tenant's outbox rows, including `user.signed_up.v1`. Once the relay ships, consider a compensating `user.discarded.v1` (also needed for DPDP deletion propagation).
- Tenant switch: `POST /v1/session/tenant` only sets an active membership, and the session guard re-resolves the membership per request, so a stale or bogus `active_tenant_id` grants nothing. A SQL WITH CHECK on sessions was not added: the touch-on-request update would then fail for disabled members.
- Slug-collision retry in signup has no test (random 24-bit suffix can't be forced to collide without a seam).
- ESLint 9 is marked deprecated on npm. Blocked on ESLint 10: eslint-config-next 16.4.5 pulls eslint-plugin-react / -import / -jsx-a11y whose peer ranges stop at ESLint 9. Revisit when they support 10.
- drizzle-kit 0.31 pulls deprecated `@esbuild-kit/*` (transitive). Goes away with drizzle-kit 1.0 (currently RC).
- Dev to do: in GitHub branch protection for `main`, mark `checks (ubuntu-latest)`, `checks (windows-latest)` and `integration (ubuntu-latest)` as required checks.
- Docker images in CI are tag-pinned (`pgvector/pgvector:0.8.6-pg18`), not digest-pinned; pin digests in M8 if reproducibility matters.
- `db:bootstrap` sends the app_user password to Postgres as a plain-text literal over TLS (Neon checks password entropy, so a pre-hashed SCRAM verifier may be rejected). Revisit if server-side statement logging is ever enabled.
- Turbo `envMode: loose` + `test` uncached: simple and correct for now; tighten env declarations if CI time matters.
