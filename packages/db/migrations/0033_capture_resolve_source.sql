-- M2-T2: public capture endpoints (form now, webhook in M2-T3) have no session, so they can't set
-- app.tenant_id before knowing the tenant. This definer resolves an unguessable source public key
-- to its tenant and capture config — only for a live, active source of an active tenant — and
-- returns nothing else. Everything after it runs in a normal tenant transaction (RLS).
CREATE FUNCTION "capture_resolve_source"(p_public_key text)
RETURNS TABLE (tenant_id uuid, source_id uuid, name text, type text, config jsonb)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT s.tenant_id, s.id, s.name, s.type::text, s.config
  FROM public.lead_sources s
  JOIN public.tenants t ON t.id = s.tenant_id
  WHERE s.public_key = p_public_key
    AND s.deleted_at IS NULL
    AND s.is_active
    AND t.status = 'active'
  LIMIT 1;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "capture_resolve_source"(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "capture_resolve_source"(text) TO "app_user";
