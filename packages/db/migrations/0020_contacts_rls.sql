-- M1-T1: tenant isolation for contacts (tenantRlsSql). No DELETE for app_user: soft delete (deleted_at).
ALTER TABLE "contacts" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "contacts" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "contacts" AS PERMISSIVE FOR ALL TO PUBLIC USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
REVOKE ALL ON "contacts" FROM "app_user";
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "contacts" TO "app_user";
