-- M1-T4: tenant isolation for saved_views (tenantRlsSql). Views are private to their user: the
-- repository always filters by user_id. DELETE allowed (a view is just a preference).
ALTER TABLE "saved_views" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "saved_views" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "saved_views" AS PERMISSIVE FOR ALL TO PUBLIC USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
REVOKE ALL ON "saved_views" FROM "app_user";
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "saved_views" TO "app_user";
