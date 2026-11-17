-- M1-T3b: tenant isolation (tenantRlsSql). custom_field_pipelines rows are added/removed (no UPDATE);
-- leads are soft-deleted (no DELETE for app_user).
ALTER TABLE "custom_field_pipelines" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "custom_field_pipelines" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "custom_field_pipelines" AS PERMISSIVE FOR ALL TO PUBLIC USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
REVOKE ALL ON "custom_field_pipelines" FROM "app_user";
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON "custom_field_pipelines" TO "app_user";
--> statement-breakpoint
ALTER TABLE "leads" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "leads" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "leads" AS PERMISSIVE FOR ALL TO PUBLIC USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
REVOKE ALL ON "leads" FROM "app_user";
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "leads" TO "app_user";
