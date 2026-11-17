-- M1-T0 (signup-blocking fix): "This wasn't me / start over" must also tell the API WHICH email
-- was freed, so it can reset that email's replace allowance (the link proves inbox ownership: it
-- is only ever emailed to that address). Same checks as auth_discard_unverified_by_token (0005);
-- returns the discarded account's email (lower-cased), or NULL when the link isn't valid.
CREATE FUNCTION "auth_cancel_signup"(p_token_hash text)
RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_user_id uuid;
  v_email text;
BEGIN
  SELECT u.id, lower(u.email::text) INTO v_user_id, v_email
  FROM public.auth_tokens t
  JOIN public.users u ON u.id = t.user_id
  WHERE t.token_hash = p_token_hash AND t.purpose = 'email_verify'
    AND t.used_at IS NULL AND t.expires_at > now()
    AND u.email_verified_at IS NULL
  LIMIT 1
  FOR UPDATE OF t;
  IF v_user_id IS NULL OR NOT public.auth_discard_unverified_user(v_user_id) THEN
    RETURN NULL;
  END IF;
  RETURN v_email;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "auth_cancel_signup"(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "auth_cancel_signup"(text) TO "app_user";
