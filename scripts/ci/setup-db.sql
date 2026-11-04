-- CI only: mirrors the Neon setup in docs/05-local-dev-setup.md on a throwaway
-- pgvector/pgvector:pg16 service container. Run as the container superuser via psql.
-- Passwords here are CI-only placeholders for a container that lives for one job.

-- Owner role (like neondb_owner): owns the databases, runs migrations. Not a superuser, but has
-- CREATEDB + CREATEROLE like neondb_owner, so the db:bootstrap integration test can run here.
CREATE ROLE revops_owner LOGIN CREATEDB CREATEROLE PASSWORD 'ci_owner_pw';
-- App role: non-owner, no BYPASSRLS, so forced RLS applies to it.
CREATE ROLE app_user LOGIN PASSWORD 'ci_app_pw';

CREATE DATABASE revops_dev OWNER revops_owner;
CREATE DATABASE revops_test OWNER revops_owner;

\connect revops_dev
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

\connect revops_test
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
