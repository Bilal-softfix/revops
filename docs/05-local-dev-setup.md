# 05 — Local Dev Setup (without Docker)

## Services
| Need | Dev choice | Env var |
|---|---|---|
| PostgreSQL 16 + pgvector | Neon project, nearest Asia region; two databases: `revops_dev`, `revops_test` | `DATABASE_URL`, `DATABASE_URL_TEST`, `DATABASE_URL_OWNER` (migrations) |
| Redis | Redis Cloud free database, eviction policy set to `noeviction` (BullMQ requirement) | `REDIS_URL` |
| Object storage | Local disk `./.data/storage` (gitignored) | `STORAGE_DRIVER=local` |
| Email | Console provider (prints to terminal) | `EMAIL_DRIVER=console` |
| LiveKit (S1/M4) | LiveKit Cloud free project | `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` |

## Neon setup
1. Create project → create databases `revops_dev` and `revops_test`.
2. In SQL editor on each DB: `CREATE EXTENSION IF NOT EXISTS vector; CREATE EXTENSION IF NOT EXISTS citext; CREATE EXTENSION IF NOT EXISTS pg_trgm;`
3. Create the non-owner app role (M0-T3 migration will grant table permissions):
   `CREATE ROLE app_user LOGIN PASSWORD '<strong-password>';`
4. Connection strings: owner role → `DATABASE_URL_OWNER`; `app_user` → `DATABASE_URL` / `DATABASE_URL_TEST`. Use the pooled endpoint for the app, direct endpoint for migrations. Keep `sslmode=require`.

## Redis Cloud setup
Create free database → Configuration → set eviction policy to **noeviction** → copy public endpoint + password into `REDIS_URL=rediss://default:<password>@<host>:<port>` (use `redis://` if TLS is not enabled on the free plan).

## Rules
- Dev services hold only fake/seed data. Never real leads or recordings.
- `.env` files are gitignored; `.env.example` lists every variable with a dummy value.
- Run `pnpm doctor` before `pnpm dev` whenever something feels off.
