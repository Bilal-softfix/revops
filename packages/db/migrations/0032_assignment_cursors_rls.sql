-- M2-T6: tenant isolation for assignment_cursors (tenantRlsSql). One row per tenant, upserted and
-- locked by the intake; never deleted by the app.
ALTER TABLE "assignment_cursors" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "assignment_cursors" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "assignment_cursors" AS PERMISSIVE FOR ALL TO PUBLIC USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
REVOKE ALL ON "assignment_cursors" FROM "app_user";
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "assignment_cursors" TO "app_user";
