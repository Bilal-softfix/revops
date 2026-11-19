CREATE TABLE "csv_import_errors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"import_id" uuid NOT NULL,
	"row_number" integer NOT NULL,
	"reason" text NOT NULL,
	"cells" jsonb NOT NULL,
	CONSTRAINT "csv_import_errors_row_unique" UNIQUE("tenant_id","import_id","row_number")
);
--> statement-breakpoint
CREATE TABLE "csv_imports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"source_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"file_name" text NOT NULL,
	"storage_key" text,
	"size_bytes" integer NOT NULL,
	"file_sha256" text NOT NULL,
	"headers" jsonb NOT NULL,
	"mapping" jsonb,
	"status" text DEFAULT 'uploaded' NOT NULL,
	"total_rows" integer NOT NULL,
	"processed_rows" integer DEFAULT 0 NOT NULL,
	"created_count" integer DEFAULT 0 NOT NULL,
	"reenquiry_count" integer DEFAULT 0 NOT NULL,
	"duplicate_count" integer DEFAULT 0 NOT NULL,
	"failed_count" integer DEFAULT 0 NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	CONSTRAINT "csv_imports_tenant_id_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "csv_imports_status" CHECK ("csv_imports"."status" in ('uploaded', 'queued', 'processing', 'completed', 'failed')),
	CONSTRAINT "csv_imports_file_name_length" CHECK (length("csv_imports"."file_name") between 1 and 200)
);
--> statement-breakpoint
ALTER TABLE "csv_import_errors" ADD CONSTRAINT "csv_import_errors_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "csv_import_errors" ADD CONSTRAINT "csv_import_errors_import_fk" FOREIGN KEY ("tenant_id","import_id") REFERENCES "public"."csv_imports"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "csv_imports" ADD CONSTRAINT "csv_imports_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "csv_imports" ADD CONSTRAINT "csv_imports_source_fk" FOREIGN KEY ("tenant_id","source_id") REFERENCES "public"."lead_sources"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "csv_imports_source_idx" ON "csv_imports" USING btree ("tenant_id","source_id","created_at");