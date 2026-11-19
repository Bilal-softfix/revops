-- M2-T5: tenant isolation for csv_imports / csv_import_errors (tenantRlsSql). app_user never
-- deletes either; error rows go when their import is deleted (cascade, owner only for now).
ALTER TABLE "csv_imports" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "csv_imports" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "csv_imports" AS PERMISSIVE FOR ALL TO PUBLIC USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
REVOKE ALL ON "csv_imports" FROM "app_user";
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "csv_imports" TO "app_user";
--> statement-breakpoint
ALTER TABLE "csv_import_errors" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "csv_import_errors" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "csv_import_errors" AS PERMISSIVE FOR ALL TO PUBLIC USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
REVOKE ALL ON "csv_import_errors" FROM "app_user";
--> statement-breakpoint
GRANT SELECT, INSERT ON "csv_import_errors" TO "app_user";
--> statement-breakpoint
-- After a large import (>= 1k inserted rows) the planner's statistics for the lead tables are
-- stale until autovacuum catches up; the import job refreshes them. app_user doesn't own these
-- tables, so ANALYZE runs here as the owner, on a fixed table list (no arguments).
CREATE FUNCTION "capture_analyze_lead_tables"()
RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  ANALYZE public.contacts, public.leads, public.lead_ingestions;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "capture_analyze_lead_tables"() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "capture_analyze_lead_tables"() TO "app_user";
