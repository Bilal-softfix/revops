# 05 — Local Dev Setup (without Docker)

## Toolchain
- **Node 22** via [fnm](https://github.com/Schniz/fnm) (`.nvmrc` pins 22). Enable auto-switching in your shell profile: `fnm env --use-on-cd | Out-String | Invoke-Expression` (PowerShell) or `eval "$(fnm env --use-on-cd)"` (bash/zsh).
- **pnpm** via corepack, enabled **under Node 22**: `fnm use 22; corepack enable`. The `packageManager` field pins pnpm 10.34.9. A pnpm shim installed under another Node (e.g. a system Node 24 in `C:\Program Files\nodejs`) runs pnpm on that Node; `pnpm i` then warns "Unsupported engine".
- **Engine pin:** `.node-version` / `.nvmrc` = 22, `engines.node` = `>=22.12.0 <23` (22.12 is the first with unflagged `require(esm)`, which apps/api needs), and `.npmrc` `engine-strict=true`. Any pnpm command on a non-22 Node fails instead of silently running.
- **Python 3.12** via [uv](https://docs.astral.sh/uv/) only. Don't rely on a system Python; `apps/voice-agent/.python-version` makes `uv` provision 3.12.
- First run: copy `.env.example` → `.env` (repo root) and `apps/api/.env.example` → `apps/api/.env`, fill them in, then `pnpm i && pnpm run doctor && pnpm dev` (api :4000, web :3000, worker, voice-agent hello-world).

## CI (GitHub Actions, `.github/workflows/ci.yml`)
- `checks (ubuntu-latest)`: typecheck, lint, unit, build, `pnpm audit --prod` (warn only). `checks (windows-latest)`: typecheck, unit, build.
- `integration (ubuntu-latest)`: Postgres 16 + pgvector and Redis 7 as service containers (Docker exists only in CI). `scripts/ci/setup-db.sql` mirrors the Neon setup below, then `pnpm run doctor` and `pnpm test:integration` run.
- Each job times out after 15 min; a new push cancels the in-flight run for the same branch/PR. pnpm store and uv caches are restored per run.

## Services
| Need | Dev choice | Env var |
|---|---|---|
| PostgreSQL 16 + pgvector | Neon project, nearest Asia region; two databases: `revops_dev`, `revops_test` | `DATABASE_URL`, `DATABASE_URL_TEST`, `DATABASE_URL_OWNER` (migrations), `DATABASE_URL_TEST_OWNER` (test migrations) |
| Redis | Redis Cloud free database, eviction policy set to `noeviction` (BullMQ requirement) | `REDIS_URL` |
| Object storage | Local disk `./.data/storage` (gitignored) | `STORAGE_DRIVER=local` |
| Email | Console provider (prints to terminal) | `EMAIL_DRIVER=console` |
| LiveKit (S1/M4) | LiveKit Cloud free project | `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` |

## Neon setup (scripted — no SQL editor needed)
1. Create a Neon project in the nearest Asia region (e.g. Singapore `ap-southeast-1`, or Mumbai if your plan offers it).
2. Neon console → **Connect** → role `neondb_owner`, database `neondb` → copy the connection string (pooled or direct both work).
3. Put it in the repo-root `.env`: `NEON_BOOTSTRAP_URL=postgresql://neondb_owner:...@ep-....neon.tech/neondb?sslmode=require`
4. Run `pnpm run db:bootstrap`. Idempotent, safe to rerun. It:
   - creates databases `revops_dev` and `revops_test` (skips existing ones);
   - runs `CREATE EXTENSION IF NOT EXISTS vector, citext, pg_trgm` in **both**;
   - creates role `app_user` (LOGIN, NOSUPERUSER, NOBYPASSRLS, owns nothing) with a generated 256-bit URL-safe password. It skips this if the role exists, and then **never prints the password**: the lines show `<APP_USER_PASSWORD>` instead;
   - prints four ready-to-paste lines: `DATABASE_URL` / `DATABASE_URL_TEST` = `app_user` on the **pooled** host (`ep-<id>-pooler…`), `DATABASE_URL_OWNER` / `DATABASE_URL_TEST_OWNER` = owner on the **direct** host. `sslmode`/`channel_binding` are kept from your URL.
5. Paste the four lines into `.env`. The `app_user` password is shown once only, so save it in your password manager.
6. Lost the `app_user` password? Run `pnpm run db:bootstrap --reset-app-password`. It rotates the password and prints the new lines; update `.env` everywhere it's used.
7. `pnpm run doctor` → all ✔ for the four database checks.

The script connects to the direct endpoint for admin work (`CREATE DATABASE` must not go through PgBouncer). It needs a role with CREATEDB + CREATEROLE (`neondb_owner` has both) and refuses otherwise. Table grants for `app_user` come from the M0-T3 migrations, not from this script. Its integration test runs in CI against the Postgres container (locally only with `RUN_BOOTSTRAP_INTEGRATION=1`, because it creates and drops throwaway `bt_*` databases).

Manual equivalent, if you ever have SQL access: in each DB `CREATE EXTENSION IF NOT EXISTS vector; CREATE EXTENSION IF NOT EXISTS citext; CREATE EXTENSION IF NOT EXISTS pg_trgm;` and once `CREATE ROLE app_user LOGIN PASSWORD '<strong-password>';`.

## Redis Cloud setup
Create free database → Configuration → set eviction policy to **noeviction** → copy public endpoint + password into `REDIS_URL=rediss://default:<password>@<host>:<port>` (use `redis://` if TLS is not enabled on the free plan).

## Rules
- Dev services hold only fake/seed data. Never real leads or recordings.
- `.env` files are gitignored; `.env.example` lists every variable with a dummy value.
- Run `pnpm run doctor` (not `pnpm doctor`, which is a pnpm built-in) before `pnpm dev` whenever something feels off.
