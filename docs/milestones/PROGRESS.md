# PROGRESS

## Current
Milestone: M0 — Foundation (in progress). Branch: `milestone/m0-foundation`.
Plan approved 2026-11-04. M0-T1, M0-T2 done 2026-11-04; M0-T3, M0-T4 done 2026-11-05; M0-T5 done 2026-11-11. 2026-11-11: switched to local-first (ADR-011 no Redis/pg-boss, ADR-012 native Postgres). Next: M0-T6 Platform plumbing (without Redis), then M0-T7 — sequential, no parallel lanes. Draft PR #1 open, CI green.

## Done
- [x] M0-T1 Monorepo scaffold (2026-11-04)
- [x] M0-T2 CI (2026-11-04) — green on GitHub (draft PR #1) after two fixes: build workspace deps before doctor, extensions in template1 for the CI owner
- [x] M0-T3 DB layer + tenancy core (2026-11-05): Drizzle schema + migrations, `withTenant`, `tenantRlsSql` generator, seed, test-DB strategy, leak suite + 2 meta-tests
- [x] M0-T4 Auth (2026-11-05): signup/verify/login/logout/me/forgot/reset under /v1/auth, opaque `__Host-sid` sessions, CSRF, argon2id, rate limits, users/sessions/auth_tokens RLS + 3 SECURITY DEFINER lookups, security review fixes (migration 0004)
- [x] M0-T5 RBAC + invitations (2026-11-11): permission map + `@RequirePermission`, members list/role/disable with last-owner lock, invitations (create/list/resend/revoke/accept), tenant switcher; role × route matrix + invitation leak tests
- [x] M0 prep: `pnpm run db:bootstrap` — scripted Neon setup (DBs, extensions, app_user, env lines), since the Neon SQL editor isn't usable (2026-11-04)
- [x] M0 local-first switch (2026-11-11): Redis removed (ADR-011: pg-boss for jobs from T6, Postgres rate limiter now via `rate_limit_buckets` + definer functions, migrations 0009/0010); native PostgreSQL 18 for dev/test (ADR-012: `DB_BOOTSTRAP_URL`, superuser mode creates `revops_owner`, verify-only reruns, `sslmode=disable` for localhost, pgvector optional until M4); second demo tenant in the seed

## In progress
- [ ] M0-T6 Platform plumbing
- [ ] M0-T7 Web shell

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
- 2026-11-05 · M0-T4 follow-up: all account-state work for signup, resend and forgot runs as a `BackgroundTasks` task after the 202. It is in-process for now (lost on crash, which is acceptable for dev). T6 moves it to BullMQ. Tests use a queued implementation to prove nothing state-dependent runs before the response.
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
- 2026-11-11 · Rate limiter: `rate_limit_buckets` stores sha256(key) only (no IPs/emails), RLS enabled with no policies and no grants, reached via `rate_limit_consume/reset/purge` (definer). The app passes its Clock's now, so FakeClock tests keep working. RLS catalog meta-test gains a "system tables" class. Purge is scheduled in T6.

## Blocked on external
- [ ] Meta Business Verification + App Review
- [ ] WhatsApp Cloud API number + templates
- [ ] Telephony provider KYC + numbers
- [ ] Legal review (DPDP, consent texts)
- [ ] Segment decision + design partners
- [ ] Dev: install pgvector on the local Postgres 18 before M4 (optional until then)

## Tech debt
_(non-blocking review findings)_
- M8: `trust proxy` must be set to the real hop count / proxy CIDRs before deploying behind a load balancer; until then `req.ip` is the proxy and the (IP, email) limiter degrades to per-email (lockout risk), while a blanket `trust proxy=true` would make IPs spoofable.
- M0-T6: schedule `rate_limit_purge` (pg-boss cron) so ended windows don't accumulate.
- M0-T6: move `BackgroundTasks` (signup, resend, forgot, emails) onto pg-boss jobs so that work is durable and retried. In-process tasks are lost if the API crashes mid-task.
- M0-T6: schedule `UnverifiedAccountCleanupJob` (hourly repeatable job in the worker).
- M0-T7: the verify page must ask for the password and offer "This wasn't me" (`/v1/auth/verify-email/cancel`) as an explicit button, never auto-submitted on load (mail link scanners). The login error copy should say "wrong email or password, or your email isn't verified yet — check your inbox".
- M0-T6: discarding an unverified account deletes its tenant's outbox rows, including `user.signed_up.v1`. Once the relay ships, consider a compensating `user.discarded.v1` (also needed for DPDP deletion propagation).
- Tenant switch: `POST /v1/session/tenant` only sets an active membership, and the session guard re-resolves the membership per request, so a stale or bogus `active_tenant_id` grants nothing. A SQL WITH CHECK on sessions was not added: the touch-on-request update would then fail for disabled members.
- M0-T7: the accept-invite page needs a "signed in as the wrong user" state (`invitation_email_mismatch`) and a "sign in first" state (`invitation_login_required`).
- Slug-collision retry in signup has no test (random 24-bit suffix can't be forced to collide without a seam).
- ESLint 9 is marked deprecated on npm. Blocked on ESLint 10: eslint-config-next 16.4.5 pulls eslint-plugin-react / -import / -jsx-a11y whose peer ranges stop at ESLint 9. Revisit when they support 10.
- drizzle-kit 0.31 pulls deprecated `@esbuild-kit/*` (transitive). Goes away with drizzle-kit 1.0 (currently RC).
- Dev to do: in GitHub branch protection for `main`, mark `checks (ubuntu-latest)`, `checks (windows-latest)` and `integration (ubuntu-latest)` as required checks.
- Docker images in CI are tag-pinned (`pgvector/pgvector:0.8.6-pg18`), not digest-pinned; pin digests in M8 if reproducibility matters.
- `db:bootstrap` sends the app_user password to Postgres as a plain-text literal over TLS (Neon checks password entropy, so a pre-hashed SCRAM verifier may be rejected). Revisit if server-side statement logging is ever enabled.
- Turbo `envMode: loose` + `test` uncached: simple and correct for now; tighten env declarations if CI time matters.
