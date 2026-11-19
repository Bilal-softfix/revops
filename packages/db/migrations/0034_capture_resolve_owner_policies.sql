-- M2-T2: capture_resolve_source (0033) runs as the owner, and lead_sources / tenants are FORCE RLS,
-- so without a tenant set the owner sees no rows either. Same pattern as the outbox relay (0012):
-- read-only policies for the role running this migration (the owner) — never for app_user, whose
-- only way in is the definer function, which returns one active source by its unguessable key.
-- The catalog meta-test pins these.
CREATE POLICY "capture_resolve_select" ON "lead_sources" AS PERMISSIVE FOR SELECT TO CURRENT_USER USING (true);
--> statement-breakpoint
CREATE POLICY "capture_resolve_select" ON "tenants" AS PERMISSIVE FOR SELECT TO CURRENT_USER USING (true);
