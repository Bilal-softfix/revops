-- M0-T4: RLS for the global, user-scoped tables (users, sessions, auth_tokens) plus narrowly scoped
-- SECURITY DEFINER lookups for the few auth steps that run before any context exists.
--
-- These tables have RLS ENABLED but not FORCED: app_user (never an owner) is fully bound, while the
-- functions below, owned by the migration (table-owner) role, can do their single lookup. Tenant
-- tables stay FORCED. test/rls-catalog.int.test.ts pins all of this.
--
-- app.user_id = acting user; app.tenant_id = current tenant (both set by withContext).

-- users: self, or a member of the current tenant. Insert/update self only. No DELETE.
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "user_visibility" ON "users" AS PERMISSIVE FOR SELECT TO PUBLIC USING (
  "id" = nullif(current_setting('app.user_id', true), '')::uuid
  OR EXISTS (
    SELECT 1 FROM "memberships" m
    WHERE m."user_id" = "users"."id"
      AND m."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid
  )
);
--> statement-breakpoint
CREATE POLICY "user_self_insert" ON "users" AS PERMISSIVE FOR INSERT TO PUBLIC
  WITH CHECK ("id" = nullif(current_setting('app.user_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "user_self_update" ON "users" AS PERMISSIVE FOR UPDATE TO PUBLIC
  USING ("id" = nullif(current_setting('app.user_id', true), '')::uuid)
  WITH CHECK ("id" = nullif(current_setting('app.user_id', true), '')::uuid);
--> statement-breakpoint
REVOKE ALL ON "users" FROM "app_user";
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "users" TO "app_user";
--> statement-breakpoint

-- sessions / auth_tokens: only the owning user's rows.
ALTER TABLE "sessions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "user_isolation" ON "sessions" AS PERMISSIVE FOR ALL TO PUBLIC
  USING ("user_id" = nullif(current_setting('app.user_id', true), '')::uuid)
  WITH CHECK ("user_id" = nullif(current_setting('app.user_id', true), '')::uuid);
--> statement-breakpoint
REVOKE ALL ON "sessions" FROM "app_user";
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "sessions" TO "app_user";
--> statement-breakpoint
ALTER TABLE "auth_tokens" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "user_isolation" ON "auth_tokens" AS PERMISSIVE FOR ALL TO PUBLIC
  USING ("user_id" = nullif(current_setting('app.user_id', true), '')::uuid)
  WITH CHECK ("user_id" = nullif(current_setting('app.user_id', true), '')::uuid);
--> statement-breakpoint
REVOKE ALL ON "auth_tokens" FROM "app_user";
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "auth_tokens" TO "app_user";
--> statement-breakpoint

-- In a user-only context (no tenant set), a user may also read its own memberships and the tenants
-- they belong to: choosing the session's tenant at login, and the tenant switcher (M0-T5). As soon
-- as a tenant is set, only the strict tenant_isolation policy applies. Read-only.
CREATE POLICY "self_select" ON "memberships" AS PERMISSIVE FOR SELECT TO PUBLIC USING (
  nullif(current_setting('app.tenant_id', true), '')::uuid IS NULL
  AND "user_id" = nullif(current_setting('app.user_id', true), '')::uuid
);
--> statement-breakpoint
CREATE POLICY "self_select" ON "tenants" AS PERMISSIVE FOR SELECT TO PUBLIC USING (
  nullif(current_setting('app.tenant_id', true), '')::uuid IS NULL
  AND EXISTS (
    SELECT 1 FROM "memberships" m
    WHERE m."tenant_id" = "tenants"."id"
      AND m."user_id" = nullif(current_setting('app.user_id', true), '')::uuid
  )
);
--> statement-breakpoint

-- SECURITY DEFINER lookups: fixed search_path (pg_temp last), schema-qualified objects, only the
-- fields each caller needs, EXECUTE for app_user only.

-- Login / resend verification / forgot password: find a user by email before any context exists.
CREATE FUNCTION "auth_find_user_by_email"(p_email text)
RETURNS TABLE (id uuid, password_hash text, email_verified_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT u.id, u.password_hash, u.email_verified_at
  FROM public.users u
  WHERE u.email = p_email::public.citext
$$;
--> statement-breakpoint
-- Request authentication: a live (not revoked, not expired) session by token hash.
-- The idle timeout is checked by the caller against last_seen_at.
CREATE FUNCTION "auth_session_lookup"(p_token_hash text)
RETURNS TABLE (session_id uuid, user_id uuid, active_tenant_id uuid, last_seen_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT s.id, s.user_id, s.active_tenant_id, s.last_seen_at
  FROM public.sessions s
  WHERE s.token_hash = p_token_hash AND s.revoked_at IS NULL AND s.expires_at > now()
$$;
--> statement-breakpoint
-- Email verification / password reset: atomically mark a valid token used; returns its user id,
-- or NULL if unknown, expired, already used, or for another purpose. Single use even under races.
CREATE FUNCTION "auth_consume_token"(p_token_hash text, p_purpose public.auth_token_purpose)
RETURNS uuid
LANGUAGE sql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  UPDATE public.auth_tokens t
  SET used_at = now()
  WHERE t.token_hash = p_token_hash AND t.purpose = p_purpose
    AND t.used_at IS NULL AND t.expires_at > now()
  RETURNING t.user_id
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "auth_find_user_by_email"(text) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "auth_session_lookup"(text) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "auth_consume_token"(text, public.auth_token_purpose) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "auth_find_user_by_email"(text) TO "app_user";
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "auth_session_lookup"(text) TO "app_user";
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "auth_consume_token"(text, public.auth_token_purpose) TO "app_user";
