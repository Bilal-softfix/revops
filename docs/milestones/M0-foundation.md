# M0 — Foundation
**Depends on:** nothing · **Size:** M

## Goal
A running monorepo where a user can sign up, create a tenant, invite teammates with roles — with tenant isolation enforced by Postgres RLS and proven by tests, CI green.

## Out of scope
Any CRM feature, billing, OTP login, SSO.

## Tasks
**M0-T1 Monorepo scaffold** — pnpm + Turborepo; apps/web, apps/api (http + worker entrypoints), apps/voice-agent (uv project, hello-world), packages/{db,shared,config}; strict tsconfig; eslint (incl. import boundaries between api modules), prettier; Vitest; `.env.example` per app; **no Docker** — `pnpm run doctor` script (Node) that validates env vars and checks Postgres (roles, required extensions; `vector` optional until M4 — ADR-012); no Redis (ADR-011); cross-platform scripts only.
- AC: with `.env` filled per `docs/05-local-dev-setup.md`, `pnpm i && pnpm run doctor && pnpm dev` starts everything on Windows/macOS/Linux; `pnpm typecheck lint test build` pass.

**M0-T2 CI** — GitHub Actions: install (cache), typecheck, lint, unit, integration (Postgres 18 + pgvector as a GitHub service container — Docker exists only in CI; no Redis, ADR-011), build, voice-agent ruff/mypy/pytest, `pnpm audit --prod` (warn).
- AC: PR shows all checks; failing test fails the build.

**M0-T3 DB layer + tenancy core** — Drizzle setup, migration scripts, `app_user` non-owner role, `tenants`, `users`, `memberships`, `audit_logs`, `outbox_events`; `withTenant()` helper; RLS policy generator helper for new tables; seed script. Test DB strategy: `DATABASE_URL_TEST` (separate database), migrations in Vitest globalSetup, truncate between test files, integration tests run with a single worker; a guard refuses to run tests if the test URL equals the dev URL.
- AC: integration test proves a query in tenant A's context cannot read/update/delete tenant B rows; test FAILS if the RLS policy is dropped (include a meta-test).

**M0-T4 Auth** — signup (creates user + tenant + owner membership), login/logout, opaque session cookie (httpOnly, Secure, SameSite=Lax), CSRF, email verification + password reset via email adapter (`ConsoleEmailProvider` in dev prints the email + link to the terminal), argon2id, login rate limit.
- AC: e2e: signup → verify email → login → dashboard; wrong password ×N → 429; session revocation on logout.

**M0-T5 RBAC + invitations** — roles owner/admin/manager/agent, permission map, `@RequirePermission()` guard, invite by email, accept invite, change role, disable member; tenant switcher if user has multiple memberships.
- AC: tests for each role against a protected route matrix; agent cannot invite; last owner cannot be demoted.

**M0-T6 Platform plumbing** — problem+json error filter, request id + pino logging with PII masking, OpenTelemetry tracing, `/health` and `/ready`, Prometheus `/metrics`, OpenAPI generation at `/docs` (non-prod), outbox relay worker skeleton with pg-boss (ADR-011, behind our queue interface) + one demo consumer and idempotency helper; schedule the unverified-account and rate-limit purges as pg-boss cron jobs.
- AC: an outbox event written in a transaction is delivered once even if relay runs twice (test).

**M0-T7 Web shell** — Next.js app layout: auth pages, app shell (sidebar, tenant switcher, user menu), settings → team page (invite/roles), shared UI kit (shadcn), API client with typed errors, loading/empty/error patterns.
- AC: Playwright covers signup→invite→accept as agent→sees restricted nav.

## Kickoff prompt (paste into Claude Code)
```
/start-milestone M0
Extra context: this is a greenfield repo; the kit files (CLAUDE.md, docs/, .claude/) are already committed. Prefer boring, well-maintained libraries. Show me the package list with versions before installing.
```

## Review checklist
- [ ] Removing an RLS policy makes the leak test fail
- [ ] App DB user is NOT table owner and cannot bypass RLS
- [ ] No secrets in repo; `.env.example` complete
- [x] Logs mask emails/phones; request id on every log line (M0-T6: logger/mask unit tests + smoke run)
- [ ] Fresh clone → running app in < 10 min following README (to verify at milestone review)
