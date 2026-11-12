-- M0-T4 follow-up, security review of 0005:
-- * discard locks the user row and re-checks "unverified" under the lock, and locks each tenant
--   before checking for other members, so it can't race a concurrent verify / reset / invite-accept;
-- * email verification and password reset each become ONE definer call (token + user update in one
--   transaction), so a concurrent discard can't leave "204 for an account that no longer exists";
-- * purge isolates failures per account.
-- Invariant relied on: an unverified user only has the single active owner membership created at
-- signup (invited users are created verified, M0-T5), so reading memberships through the active-only
-- self_select policy finds all of its tenants.

CREATE OR REPLACE FUNCTION "auth_discard_unverified_user"(p_user_id uuid)
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
  -- Lock first; if a concurrent verify won, the re-check under the lock sees it verified.
  PERFORM 1 FROM public.users u
  WHERE u.id = p_user_id AND u.email_verified_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  PERFORM set_config('app.tenant_id', '', true);
  PERFORM set_config('app.user_id', p_user_id::text, true);
  SELECT coalesce(array_agg(m.tenant_id), '{}') INTO v_tenants
  FROM public.memberships m WHERE m.user_id = p_user_id;

  FOREACH v_tenant IN ARRAY v_tenants LOOP
    PERFORM set_config('app.tenant_id', v_tenant::text, true);
    -- Lock the tenant (a concurrent membership insert takes a FK KEY SHARE lock and waits / is
    -- waited on), then check for other members in a fresh statement, i.e. a fresh snapshot.
    PERFORM 1 FROM public.tenants t WHERE t.id = v_tenant FOR UPDATE;
    DELETE FROM public.tenants t
    WHERE t.id = v_tenant
      AND NOT EXISTS (
        SELECT 1 FROM public.memberships o WHERE o.tenant_id = v_tenant AND o.user_id <> p_user_id
      );
  END LOOP;

  DELETE FROM public.users u WHERE u.id = p_user_id AND u.email_verified_at IS NULL;

  PERFORM set_config('app.tenant_id', v_prev_tenant, true);
  PERFORM set_config('app.user_id', v_prev_user, true);
  RETURN true;
END
$$;
--> statement-breakpoint

-- Verify email in one transaction: the user row (locked by the UPDATE) must still be unverified and
-- unexpired, and the link live and theirs; then every unused verify link of the user is spent.
-- Returns false (changing nothing) otherwise.
CREATE FUNCTION "auth_verify_email"(p_token_hash text, p_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  UPDATE public.users u
  SET email_verified_at = now(), updated_at = now()
  WHERE u.id = p_user_id
    AND u.email_verified_at IS NULL
    AND u.created_at > public.auth_unverified_cutoff()
    AND EXISTS (
      SELECT 1 FROM public.auth_tokens t
      WHERE t.token_hash = p_token_hash AND t.user_id = p_user_id AND t.purpose = 'email_verify'
        AND t.used_at IS NULL AND t.expires_at > now()
    );
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  UPDATE public.auth_tokens t
  SET used_at = now()
  WHERE t.user_id = p_user_id AND t.purpose = 'email_verify' AND t.used_at IS NULL;
  RETURN true;
END
$$;
--> statement-breakpoint

-- Password reset in one transaction: consume the link, set the new (already argon2-hashed)
-- password, mark the email verified (the link proves it), revoke every session and spend all other
-- reset/verify links. Expired unverified accounts are non-existent, as everywhere else.
-- Returns the user id, or NULL (changing nothing) if the link isn't live.
CREATE FUNCTION "auth_reset_password"(p_token_hash text, p_password_hash text)
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_user uuid;
BEGIN
  SELECT t.user_id INTO v_user FROM public.auth_tokens t
  WHERE t.token_hash = p_token_hash AND t.purpose = 'password_reset'
    AND t.used_at IS NULL AND t.expires_at > now();
  IF v_user IS NULL THEN
    RETURN NULL;
  END IF;

  -- Lock the user first (same order as discard), then consume the link under that lock.
  UPDATE public.users u
  SET password_hash = p_password_hash,
      email_verified_at = coalesce(u.email_verified_at, now()),
      updated_at = now()
  WHERE u.id = v_user
    AND (u.email_verified_at IS NOT NULL OR u.created_at > public.auth_unverified_cutoff());
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  UPDATE public.auth_tokens t SET used_at = now()
  WHERE t.token_hash = p_token_hash AND t.used_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'reset link already used' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.sessions s SET revoked_at = now() WHERE s.user_id = v_user AND s.revoked_at IS NULL;
  UPDATE public.auth_tokens t SET used_at = now() WHERE t.user_id = v_user AND t.used_at IS NULL;
  RETURN v_user;
END
$$;
--> statement-breakpoint

-- Purge: one account at a time, each in its own subtransaction, so one bad row (e.g. a future FK
-- that blocks the delete) is skipped and reported instead of failing the whole run forever.
CREATE OR REPLACE FUNCTION "auth_purge_expired_unverified"()
RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_user uuid;
  v_removed integer := 0;
BEGIN
  FOR v_user IN
    SELECT u.id FROM public.users u
    WHERE u.email_verified_at IS NULL AND u.created_at <= public.auth_unverified_cutoff()
  LOOP
    BEGIN
      IF public.auth_discard_unverified_user(v_user) THEN
        v_removed := v_removed + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'auth_purge_expired_unverified: user % skipped (%)', v_user, SQLSTATE;
    END;
  END LOOP;
  RETURN v_removed;
END
$$;
--> statement-breakpoint

-- Superseded by the atomic functions above.
DROP FUNCTION "auth_consume_token"(text, public.auth_token_purpose);
--> statement-breakpoint
REVOKE ALL ON FUNCTION "auth_verify_email"(text, uuid) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "auth_reset_password"(text, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "auth_verify_email"(text, uuid) TO "app_user";
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "auth_reset_password"(text, text) TO "app_user";
