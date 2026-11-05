-- M0-T4 follow-up (pre-account hijack): unverified accounts expire after 48 h, can be replaced by
-- a fresh signup or discarded via their emailed link, and verification needs the password.
--
-- The 48 h lifetime lives here, in one place: auth_unverified_cutoff().

CREATE FUNCTION "auth_unverified_cutoff"()
RETURNS timestamptz
LANGUAGE sql STABLE
SET search_path = pg_catalog, pg_temp
AS $$ SELECT now() - interval '48 hours' $$;
--> statement-breakpoint

-- Login / resend / forgot: an expired unverified account is treated as non-existent.
CREATE OR REPLACE FUNCTION "auth_find_user_by_email"(p_email text)
RETURNS TABLE (id uuid, password_hash text, email_verified_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT u.id, u.password_hash, u.email_verified_at
  FROM public.users u
  WHERE u.email = p_email::public.citext
    AND (u.email_verified_at IS NOT NULL OR u.created_at > public.auth_unverified_cutoff())
$$;
--> statement-breakpoint

-- Verify step 1: who does this (unused, unexpired) verify token belong to, and what is their
-- password hash? Only for unverified, unexpired accounts. Does NOT consume the token.
CREATE FUNCTION "auth_peek_verify_token"(p_token_hash text)
RETURNS TABLE (user_id uuid, password_hash text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT u.id, u.password_hash
  FROM public.auth_tokens t
  JOIN public.users u ON u.id = t.user_id
  WHERE t.token_hash = p_token_hash AND t.purpose = 'email_verify'
    AND t.used_at IS NULL AND t.expires_at > now()
    AND u.email_verified_at IS NULL AND u.created_at > public.auth_unverified_cutoff()
$$;
--> statement-breakpoint

-- Deletes an UNVERIFIED user, the tenants only it belongs to (cascading their memberships, audit
-- logs and outbox rows), its tokens and sessions. No-op (false) for verified users.
-- memberships/tenants are FORCE RLS, which binds even this owner-run function, so it reads the
-- user's memberships in a user-only context and deletes each tenant inside that tenant's context,
-- then restores the caller's context. Not granted to app_user: reached only via the wrappers below.
CREATE FUNCTION "auth_discard_unverified_user"(p_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_prev_tenant text := coalesce(current_setting('app.tenant_id', true), '');
  v_prev_user text := coalesce(current_setting('app.user_id', true), '');
  v_tenants uuid[];
  v_tenant uuid;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.users u WHERE u.id = p_user_id AND u.email_verified_at IS NULL
  ) THEN
    RETURN false;
  END IF;

  PERFORM set_config('app.tenant_id', '', true);
  PERFORM set_config('app.user_id', p_user_id::text, true);
  SELECT coalesce(array_agg(m.tenant_id), '{}') INTO v_tenants
  FROM public.memberships m WHERE m.user_id = p_user_id;

  FOREACH v_tenant IN ARRAY v_tenants LOOP
    PERFORM set_config('app.tenant_id', v_tenant::text, true);
    DELETE FROM public.tenants t
    WHERE t.id = v_tenant
      AND NOT EXISTS (
        SELECT 1 FROM public.memberships o WHERE o.tenant_id = v_tenant AND o.user_id <> p_user_id
      );
  END LOOP;

  DELETE FROM public.users u WHERE u.id = p_user_id;

  PERFORM set_config('app.tenant_id', v_prev_tenant, true);
  PERFORM set_config('app.user_id', v_prev_user, true);
  RETURN true;
END
$$;
--> statement-breakpoint

-- Signup for an email whose account is still unverified (pending or expired): the pending account
-- is replaced, so its password, tenant and old links all stop working.
CREATE FUNCTION "auth_discard_unverified_by_email"(p_email text)
RETURNS boolean
LANGUAGE sql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT coalesce(bool_or(public.auth_discard_unverified_user(u.id)), false)
  FROM public.users u
  WHERE u.email = p_email::public.citext AND u.email_verified_at IS NULL
$$;
--> statement-breakpoint

-- "This wasn't me / start over": a valid verify link proves inbox ownership, so it may discard
-- the unverified account it belongs to.
CREATE FUNCTION "auth_discard_unverified_by_token"(p_token_hash text)
RETURNS boolean
LANGUAGE sql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT coalesce(bool_or(public.auth_discard_unverified_user(t.user_id)), false)
  FROM public.auth_tokens t
  WHERE t.token_hash = p_token_hash AND t.purpose = 'email_verify'
    AND t.used_at IS NULL AND t.expires_at > now()
$$;
--> statement-breakpoint

-- Cleanup job (scheduled by the worker in M0-T6): discards every unverified account older than
-- the cutoff. Returns how many were removed.
CREATE FUNCTION "auth_purge_expired_unverified"()
RETURNS integer
LANGUAGE sql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  -- The discard runs in the aggregate FILTER, i.e. only for rows that passed WHERE. (Inside WHERE,
  -- Postgres may evaluate it before the age check and delete fresh accounts.)
  SELECT (count(*) FILTER (WHERE public.auth_discard_unverified_user(u.id)))::integer
  FROM public.users u
  WHERE u.email_verified_at IS NULL AND u.created_at <= public.auth_unverified_cutoff()
$$;
--> statement-breakpoint

REVOKE ALL ON FUNCTION "auth_unverified_cutoff"() FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "auth_peek_verify_token"(text) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "auth_discard_unverified_user"(uuid) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "auth_discard_unverified_by_email"(text) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "auth_discard_unverified_by_token"(text) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "auth_purge_expired_unverified"() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "auth_peek_verify_token"(text) TO "app_user";
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "auth_discard_unverified_by_email"(text) TO "app_user";
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "auth_discard_unverified_by_token"(text) TO "app_user";
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "auth_purge_expired_unverified"() TO "app_user";
