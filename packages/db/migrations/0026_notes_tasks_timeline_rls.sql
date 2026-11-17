-- M1-T5: tenant isolation (tenantRlsSql). Notes and tasks are soft-deleted (no DELETE for app_user);
-- timeline_events is append-only (SELECT + INSERT).
ALTER TABLE "notes" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "notes" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "notes" AS PERMISSIVE FOR ALL TO PUBLIC USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
REVOKE ALL ON "notes" FROM "app_user";
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "notes" TO "app_user";
--> statement-breakpoint
ALTER TABLE "tasks" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "tasks" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "tasks" AS PERMISSIVE FOR ALL TO PUBLIC USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
REVOKE ALL ON "tasks" FROM "app_user";
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "tasks" TO "app_user";
--> statement-breakpoint
ALTER TABLE "timeline_events" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "timeline_events" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "timeline_events" AS PERMISSIVE FOR ALL TO PUBLIC USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
REVOKE ALL ON "timeline_events" FROM "app_user";
--> statement-breakpoint
GRANT SELECT, INSERT ON "timeline_events" TO "app_user";
