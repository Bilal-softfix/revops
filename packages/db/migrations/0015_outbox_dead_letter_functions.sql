-- M1-T0: dead-lettering. A row the relay can't validate (unknown type, payload failing its
-- schema) is set aside with a reason instead of being retried forever at the head of the queue,
-- where it would block delivery for every tenant.

-- Same signature as 0012; now skips dead-lettered rows.
CREATE OR REPLACE FUNCTION "outbox_claim_batch"(p_limit integer)
RETURNS TABLE (
  id uuid, tenant_id uuid, type text, aggregate_id uuid, payload jsonb, occurred_at timestamptz
)
LANGUAGE sql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT o.id, o.tenant_id, o.type, o.aggregate_id, o.payload, o.occurred_at
  FROM outbox_events o
  WHERE o.published_at IS NULL AND o.dead_lettered_at IS NULL
  ORDER BY o.occurred_at, o.id
  LIMIT least(greatest(coalesce(p_limit, 1), 1), 500)
  FOR UPDATE SKIP LOCKED
$$;
--> statement-breakpoint

-- Sets one claimed, still-pending event aside. The reason is truncated and must never hold
-- payload values (the caller passes schema paths/codes only). Returns whether the row changed.
CREATE FUNCTION "outbox_dead_letter"(p_id uuid, p_reason text, p_now timestamptz)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_count integer;
BEGIN
  UPDATE outbox_events
  SET dead_lettered_at = p_now, dead_letter_reason = left(coalesce(p_reason, 'invalid'), 500)
  WHERE id = p_id AND published_at IS NULL AND dead_lettered_at IS NULL;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count > 0;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "outbox_dead_letter"(uuid, text, timestamptz) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "outbox_dead_letter"(uuid, text, timestamptz) TO "app_user";
