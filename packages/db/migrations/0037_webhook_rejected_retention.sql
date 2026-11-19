CREATE INDEX "inbound_webhooks_rejected_idx" ON "inbound_webhooks" USING btree ("tenant_id","source_id","received_at") WHERE "inbound_webhooks"."status" = 'rejected';--> statement-breakpoint
-- M2-T3 review: rejected (unauthenticated) deliveries are kept 7 days, everything else 30.
-- Replaces the one-cutoff purge from 0036 (same owner, grants and search_path).
DROP FUNCTION "capture_purge_inbound_webhooks"(timestamptz);
--> statement-breakpoint
CREATE FUNCTION "capture_purge_inbound_webhooks"(p_before timestamptz, p_rejected_before timestamptz)
RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_count integer;
BEGIN
  DELETE FROM public.inbound_webhooks
  WHERE received_at < p_before
     OR (status = 'rejected' AND received_at < p_rejected_before);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "capture_purge_inbound_webhooks"(timestamptz, timestamptz) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "capture_purge_inbound_webhooks"(timestamptz, timestamptz) TO "app_user";
