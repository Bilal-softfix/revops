-- M2-T4: tenant isolation for lead_ingestions (tenantRlsSql). The intake inserts the row first
-- (idempotency claim) and updates it with the outcome; rows are never deleted by the app.
ALTER TABLE "lead_ingestions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "lead_ingestions" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "lead_ingestions" AS PERMISSIVE FOR ALL TO PUBLIC USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
REVOKE ALL ON "lead_ingestions" FROM "app_user";
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "lead_ingestions" TO "app_user";
