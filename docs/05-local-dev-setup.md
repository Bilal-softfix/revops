# 05 — Local Dev Setup (local-first, without Docker)

Everything runs on the dev machine: Node 22, Python 3.12 (uv) and a natively installed **PostgreSQL 18**. No Redis (ADR-011), no cloud services (ADR-012), no Docker (ADR-009).

## Toolchain
- **Node 22** via [fnm](https://github.com/Schniz/fnm) (`.nvmrc` pins 22). Enable auto-switching in your shell profile: `fnm env --use-on-cd | Out-String | Invoke-Expression` (PowerShell) or `eval "$(fnm env --use-on-cd)"` (bash/zsh).
- **pnpm** via corepack, enabled **under Node 22**: `fnm use 22; corepack enable`. The `packageManager` field pins pnpm 10.34.9. A pnpm shim installed under another Node (e.g. a system Node 24 in `C:\Program Files\nodejs`) runs pnpm on that Node; `pnpm i` then warns "Unsupported engine".
- **Engine pin:** `.node-version` / `.nvmrc` = 22, `engines.node` = `>=22.12.0 <23` (22.12 is the first with unflagged `require(esm)`, which apps/api needs), and `.npmrc` `engine-strict=true`. Any pnpm command on a non-22 Node fails instead of silently running.
- **Python 3.12** via [uv](https://docs.astral.sh/uv/) only. Don't rely on a system Python; `apps/voice-agent/.python-version` makes `uv` provision 3.12.
- First run: copy `.env.example` → `.env` (repo root) and `apps/api/.env.example` → `apps/api/.env`, fill them in, then `pnpm i && pnpm run doctor && pnpm dev` (api :4000, web :3000, worker, voice-agent hello-world).

## CI (GitHub Actions, `.github/workflows/ci.yml`)
- `checks (ubuntu-latest)`: typecheck, lint, unit, build, `pnpm audit --prod` (warn only). `checks (windows-latest)`: typecheck, unit, build.
- `e2e (ubuntu-latest)`: Postgres service + Chromium, `pnpm test:e2e`; the Playwright report is uploaded on failure.
- `integration (ubuntu-latest)`: Postgres 18 + pgvector (`pgvector/pgvector:0.8.6-pg18`, ADR-010) as a service container (Docker exists only in CI). No Redis. `scripts/ci/setup-db.sql` mirrors what `db:bootstrap` sets up, then `pnpm run doctor` and `pnpm test:integration` run. `BOOTSTRAP_SUPERUSER_URL` lets the bootstrap test exercise the superuser path a local install uses.
- Each job times out after 15 min; a new push cancels the in-flight run for the same branch/PR. pnpm store and uv caches are restored per run.

## Services
| Need | Dev choice | Env var |
|---|---|---|
| PostgreSQL 18 | Native install (Windows: EDB installer), `localhost:5432`; two databases `revops_dev`, `revops_test` | `DATABASE_URL`, `DATABASE_URL_TEST` (app_user), `DATABASE_URL_OWNER`, `DATABASE_URL_TEST_OWNER` (revops_owner, migrations) |
| pgvector | Optional until M4 — doctor warns if missing; CI has it | — |
| Jobs / queues / cron | pg-boss in the same Postgres: `pgboss` schema, installed by `pnpm db:migrate` | `OUTBOX_POLL_INTERVAL_MS`, `WORKER_PORT` |
| Tracing | Off by default; set an OTLP/HTTP endpoint to export | `OTEL_EXPORTER_OTLP_ENDPOINT` |
| Metrics | `/metrics` on api :4000 and worker :4001, open in dev | `METRICS_TOKEN` (required in prod) |
| Rate limits | Postgres table `rate_limit_buckets` | — |
| Object storage | Local disk `./.data/storage` (gitignored) | `STORAGE_DRIVER=local` |
| Email | Console provider (prints to terminal) | `EMAIL_DRIVER=console` |
| LiveKit (S1/M4) | LiveKit Cloud free project (decided in S1) | `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` |

## PostgreSQL setup (scripted — no SQL client needed)
1. Install PostgreSQL 18 (Windows: the EDB installer; keep port 5432 and note the `postgres` superuser password). macOS: Postgres.app or Homebrew; Linux: the PGDG packages.
2. Put a superuser URL in the repo-root `.env` as `DB_BOOTSTRAP_URL`. From the repo root in PowerShell, so the password is never echoed, typed into a command line, or saved in shell history. This replaces any old `NEON_BOOTSTRAP_URL` / `DB_BOOTSTRAP_URL` line, leaves every other line alone, and writes UTF-8 without a BOM, on both Windows PowerShell 5.1 and PowerShell 7:
   ```powershell
   $sec  = Read-Host -AsSecureString "postgres superuser password"
   $enc  = [Uri]::EscapeDataString([Net.NetworkCredential]::new('', $sec).Password)
   $path = Join-Path (Get-Location) '.env'
   $keep = @(if (Test-Path $path) { Get-Content $path | Where-Object { $_ -notmatch '^\s*(DB|NEON)_BOOTSTRAP_URL\s*=' } })
   [IO.File]::WriteAllLines($path, [string[]]($keep + "DB_BOOTSTRAP_URL=postgresql://postgres:$enc@localhost:5432/postgres?sslmode=disable"))
   Remove-Variable sec, enc, keep
   ```
3. Run `pnpm run db:bootstrap --write-env`. It is idempotent and safe to rerun. Connected as a superuser it:
   - creates role `revops_owner` (LOGIN, NOSUPERUSER, NOBYPASSRLS). It owns both databases and runs the migrations, so SECURITY DEFINER functions never run as a superuser, the same as Neon and CI;
   - creates `revops_dev` and `revops_test` owned by `revops_owner`, skipping any that already exist;
   - installs `citext` and `pg_trgm` (required) and `vector` (optional: if pgvector isn't installed on the server it warns and carries on);
   - creates `app_user` (LOGIN, NOSUPERUSER, NOBYPASSRLS, owns nothing);
   - sets the role passwords last, as generated 256-bit URL-safe passwords;
   - writes the four `DATABASE_*` URLs into the root `.env` **and** `apps/api/.env`, replacing existing keys in place and keeping every other line. Local URLs get `sslmode=disable`, and no `-pooler` host is derived for non-Neon hosts;
   - **deletes `DB_BOOTSTRAP_URL`**, so the superuser password doesn't stay in the file, and prints only a masked summary.
4. Rerun it: with `DB_BOOTSTRAP_URL` gone it connects as `revops_owner` via `DATABASE_URL_OWNER` in **verify-only** mode. Nothing is created, extensions are checked, the passwords already in `.env` are verified by logging in, and every key reports `unchanged`.
5. Lost a password? Put `DB_BOOTSTRAP_URL` back and run `pnpm run db:bootstrap --write-env --reset-app-password` (or `--reset-owner-password`).
6. `pnpm db:migrate`, then `pnpm db:seed`, then `pnpm run doctor`. All database checks should be ✔; the pgvector line is a ⚠ until it's installed.

**Neon still works but is unused.** Put the `neondb_owner` URL in `DB_BOOTSTRAP_URL`. A role with CREATEDB + CREATEROLE that isn't a superuser is used as the owner itself (admin-owner mode). `app_user` URLs then go to the `-pooler` host and owner URLs to the direct host, keeping `sslmode`/`channel_binding`.

Without `--write-env` the script prints the four lines (with passwords) instead of writing them. Its integration test runs in CI against the Postgres container. Locally it runs only with `RUN_BOOTSTRAP_INTEGRATION=1`, because it creates and drops throwaway `bt_*` databases and roles; set `BOOTSTRAP_SUPERUSER_URL` as well to cover the superuser path.

## Migrations, seed and integration tests
- `pnpm db:migrate` applies `packages/db/migrations` to the dev DB as `revops_owner` over `DATABASE_URL_OWNER` (on Neon: the direct endpoint). `pnpm db:migrate --test` does the same for the test DB.
- `pnpm db:generate --name=<change>` creates a migration from `packages/db/src/schema`; add `--custom` for hand-written SQL such as RLS. Migrations are forward-only, and a merged migration is never edited.
- `pnpm db:reset:dev` (**dev only**): drops everything the migrations created in the dev database, then re-runs the migrations and the seed. Use it when the schema or the demo data/templates changed. Extensions stay, so no superuser is needed. It refuses unless the database name ends in `_dev`, `NODE_ENV` isn't `production`, and it isn't the test database.
- `pnpm db:seed`: set `SEED_PASSWORD` (at least 12 characters) in `.env` first. It runs as `app_user`, through RLS, is idempotent, and refuses to run with `NODE_ENV=production`. It creates:
  - **Demo Realty** (`demo`): `owner|admin|manager|agent@demo.revops.test`;
  - **Demo Clinic** (`demo-clinic`): `owner2@demo.revops.test`, `agent2@demo.revops.test`, and **`manager@demo.revops.test`, who belongs to both tenants**. Use them to try the tenant switcher and isolation.
- `pnpm test:integration` runs against `DATABASE_URL_TEST`:
  - a guard refuses any database whose name doesn't end in `_test`, or that is the dev database;
  - Vitest globalSetup migrates the test DB;
  - every test file starts from truncated tables;
  - files run one at a time.

## Trying auth locally (M0-T4)
- `apps/api/.env` holds API-only vars (see `apps/api/.env.example`): `APP_URL` (web origin used in email links), `EMAIL_DRIVER=console`, `EMAIL_FROM`, `COOKIE_SECURE=true`.
- `pnpm dev`, then `POST http://localhost:4000/v1/auth/signup`. The console email provider prints the verify link to the API terminal, with the recipient masked. `POST /v1/auth/verify-email {"token": …}`, then `POST /v1/auth/login`.
- Send JSON only (`content-type: application/json`). On unsafe authenticated calls such as logout, send the `csrfToken` from the login/me response as `x-csrf-token`.
- Rate limits live in Postgres (`rate_limit_buckets`), so they survive API restarts. To clear them in dev, truncate that table as `revops_owner`.

## Running the API + worker (M0-T6)
`pnpm dev` starts both. Signup, resend, forgot-password and invitation emails are **pg-boss jobs run by the worker**, so with only the API running, no emails print. In dev, the console email provider prints them in the **worker's** terminal.
- Probes: `curl localhost:4000/health`, `curl localhost:4000/ready`, and the same on :4001 for the worker. `/ready` is 503 problem+json if the DB is down or migrations didn't run (no `pgboss` schema).
- Metrics: `curl localhost:4000/metrics` and `curl localhost:4001/metrics`. When `METRICS_TOKEN` is set, add `-H "Authorization: Bearer <token>"`.
- API docs: http://localhost:4000/docs (Swagger UI) and `/docs/openapi.json`. They are generated from the shared Zod schemas and are not served in production.
- Logs: pretty-printed in dev, JSON otherwise. Send `x-request-id: <id>` and find it in the response header, every log line of that request and any problem+json body.
- Queues: the jobs live in the `pgboss` schema of `revops_dev`. To inspect them, run `select name, state, count(*) from pgboss.job group by 1, 2` as `revops_owner`.

## Web app (M0-T7)
- `pnpm dev` serves the web app at http://localhost:3000; it reaches the API through its own `/api` proxy (`API_INTERNAL_URL`, default http://localhost:4000, in `apps/web/.env`).
- Sign in with the seed users (`pnpm db:seed`, password = `SEED_PASSWORD`). Every page and email link works locally: `/signup`, `/verify-email`, `/forgot-password`, `/reset-password`, `/accept-invite`. The links print in the **worker's** terminal.
- **E2E (Playwright):**
  - Once per machine: `pnpm --filter @revops/web exec playwright install chromium`.
  - Then `pnpm test:e2e` (the test DB must be migrated first: `pnpm db:migrate --test`, because Playwright starts the worker before its own setup runs). It builds the API and web, migrates and truncates **revops_test**, and starts the built API (:4100), worker (:4101) and `next start` (:3100) with `EMAIL_DRIVER=file`. The tests read the links from `apps/web/.e2e-mail/`.
  - It doesn't touch a running `pnpm dev`. Don't run it while `pnpm test:integration` is running, because both use revops_test.
- Web unit tests: `pnpm --filter @revops/web test` (Vitest: API client, /api proxy, nav, redirects).

## Rules
- Dev services hold only fake/seed data. Never real leads or recordings.
- `.env` files are gitignored; `.env.example` lists every variable with a dummy value.
- Run `pnpm run doctor` (not `pnpm doctor`, which is a pnpm built-in) before `pnpm dev` whenever something feels off.
