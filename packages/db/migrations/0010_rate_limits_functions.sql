-- ADR-011: rate limiting moves from Redis to Postgres.
-- rate_limit_buckets is a system table: RLS ENABLED with no policies and no grants, so app_user can
-- neither read nor write it directly. Not FORCED, so these SECURITY DEFINER functions (running as
-- the owner) can. Keys arrive as sha256 hex computed in the app: no IPs/emails are stored here.
-- The caller passes "now" (the app's Clock), so windows follow the same clock as the rest of the
-- request (and a fake clock in tests).
ALTER TABLE "rate_limit_buckets" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON "rate_limit_buckets" FROM PUBLIC;
--> statement-breakpoint

-- Counts one attempt. Returns 0 while within p_limit for the current window, else the whole
-- seconds until the window ends. One INSERT .. ON CONFLICT: the row lock makes count-then-decide
-- atomic, so a concurrent burst gets exactly p_limit allowances.
CREATE FUNCTION "rate_limit_consume"(
  p_key_hash text, p_limit integer, p_window_ms integer, p_now timestamptz
)
RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_count integer;
  v_reset_at timestamptz;
BEGIN
  IF p_key_hash !~ '^[0-9a-f]{64}$' OR p_limit < 1 OR p_window_ms < 1 THEN
    RAISE EXCEPTION 'rate_limit_consume: invalid arguments' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.rate_limit_buckets AS b (key_hash, count, reset_at)
  VALUES (p_key_hash, 1, p_now + p_window_ms * interval '1 millisecond')
  ON CONFLICT (key_hash) DO UPDATE SET
    count = CASE WHEN b.reset_at <= p_now THEN 1 ELSE b.count + 1 END,
    reset_at = CASE WHEN b.reset_at <= p_now THEN excluded.reset_at ELSE b.reset_at END
  RETURNING b.count, b.reset_at INTO v_count, v_reset_at;

  IF v_count <= p_limit THEN
    RETURN 0;
  END IF;
  RETURN greatest(1, ceil(extract(epoch FROM (v_reset_at - p_now)))::integer);
END;
$$;
--> statement-breakpoint

CREATE FUNCTION "rate_limit_reset"(p_key_hash text)
RETURNS void
LANGUAGE sql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  DELETE FROM public.rate_limit_buckets WHERE key_hash = p_key_hash;
$$;
--> statement-breakpoint

-- Housekeeping (scheduled by the worker from M0-T6): drops windows that ended before p_now.
CREATE FUNCTION "rate_limit_purge"(p_now timestamptz)
RETURNS integer
LANGUAGE sql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  WITH gone AS (DELETE FROM public.rate_limit_buckets WHERE reset_at <= p_now RETURNING 1)
  SELECT count(*)::integer FROM gone;
$$;
--> statement-breakpoint

REVOKE ALL ON FUNCTION "rate_limit_consume"(text, integer, integer, timestamptz) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "rate_limit_reset"(text) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "rate_limit_purge"(timestamptz) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "rate_limit_consume"(text, integer, integer, timestamptz) TO "app_user";
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "rate_limit_reset"(text) TO "app_user";
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "rate_limit_purge"(timestamptz) TO "app_user";
