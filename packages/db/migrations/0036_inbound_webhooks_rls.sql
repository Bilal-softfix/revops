-- M2-T3: tenant isolation for inbound_webhooks (tenantRlsSql). Rows are written by the public
-- webhook endpoint and updated by the processing job; app_user never deletes them — the daily
-- retention purge runs through capture_purge_inbound_webhooks (owner, below).
ALTER TABLE "inbound_webhooks" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "inbound_webhooks" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "inbound_webhooks" AS PERMISSIVE FOR ALL TO PUBLIC USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
REVOKE ALL ON "inbound_webhooks" FROM "app_user";
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "inbound_webhooks" TO "app_user";
--> statement-breakpoint
-- Owner-only, for the purge function (same pattern as the outbox relay, 0012).
CREATE POLICY "webhook_purge_select" ON "inbound_webhooks" AS PERMISSIVE FOR SELECT TO CURRENT_USER USING (true);
--> statement-breakpoint
CREATE POLICY "webhook_purge_delete" ON "inbound_webhooks" AS PERMISSIVE FOR DELETE TO CURRENT_USER USING (true);
--> statement-breakpoint
-- The webhook endpoint has no session: resolve an active API source of an active tenant by its
-- public key, with its envelope-encrypted secret (decrypted only in the API, never in SQL).
CREATE FUNCTION "capture_resolve_webhook_source"(p_public_key text)
RETURNS TABLE (tenant_id uuid, source_id uuid, name text, config jsonb, webhook_secret_enc text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT s.tenant_id, s.id, s.name, s.config, s.webhook_secret_enc
  FROM public.lead_sources s
  JOIN public.tenants t ON t.id = s.tenant_id
  WHERE s.public_key = p_public_key
    AND s.type = 'api'
    AND s.deleted_at IS NULL
    AND s.is_active
    AND s.webhook_secret_enc IS NOT NULL
    AND t.status = 'active'
  LIMIT 1;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "capture_resolve_webhook_source"(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "capture_resolve_webhook_source"(text) TO "app_user";
--> statement-breakpoint
-- Retention (PII): deliveries received before p_before are deleted. Returns how many.
CREATE FUNCTION "capture_purge_inbound_webhooks"(p_before timestamptz)
RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_count integer;
BEGIN
  DELETE FROM public.inbound_webhooks WHERE received_at < p_before;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "capture_purge_inbound_webhooks"(timestamptz) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "capture_purge_inbound_webhooks"(timestamptz) TO "app_user";
