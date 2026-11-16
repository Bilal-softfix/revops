-- M1-T3b: pipeline scoping of lead custom fields + the leads table (API in M1-T4).
-- Unique keys first: the composite FKs below reference them.
ALTER TABLE "custom_field_defs" ADD CONSTRAINT "custom_field_defs_tenant_id_id_unique" UNIQUE("tenant_id","id");--> statement-breakpoint
ALTER TABLE "pipeline_stages" ADD CONSTRAINT "pipeline_stages_tenant_pipeline_id_unique" UNIQUE("tenant_id","pipeline_id","id");--> statement-breakpoint
CREATE TABLE "custom_field_pipelines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"field_id" uuid NOT NULL,
	"pipeline_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "custom_field_pipelines_field_pipeline_unique" UNIQUE("field_id","pipeline_id")
);
--> statement-breakpoint
CREATE TABLE "leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"pipeline_id" uuid NOT NULL,
	"stage_id" uuid NOT NULL,
	"owner_user_id" uuid,
	"source_id" uuid,
	"value_paise" bigint,
	"currency" text DEFAULT 'INR' NOT NULL,
	"attribution" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"custom_fields" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"won_at" timestamp with time zone,
	"lost_at" timestamp with time zone,
	"lost_reason" text,
	"created_by" uuid,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "leads_tenant_id_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "leads_value_non_negative" CHECK ("leads"."value_paise" is null or "leads"."value_paise" >= 0),
	CONSTRAINT "leads_currency_iso" CHECK ("leads"."currency" ~ '^[A-Z]{3}$')
);
--> statement-breakpoint
ALTER TABLE "custom_field_pipelines" ADD CONSTRAINT "custom_field_pipelines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_field_pipelines" ADD CONSTRAINT "custom_field_pipelines_field_fk" FOREIGN KEY ("tenant_id","field_id") REFERENCES "public"."custom_field_defs"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_field_pipelines" ADD CONSTRAINT "custom_field_pipelines_pipeline_fk" FOREIGN KEY ("tenant_id","pipeline_id") REFERENCES "public"."pipelines"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_contact_fk" FOREIGN KEY ("tenant_id","contact_id") REFERENCES "public"."contacts"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_stage_fk" FOREIGN KEY ("tenant_id","pipeline_id","stage_id") REFERENCES "public"."pipeline_stages"("tenant_id","pipeline_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_source_fk" FOREIGN KEY ("tenant_id","source_id") REFERENCES "public"."lead_sources"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "custom_field_pipelines_pipeline_idx" ON "custom_field_pipelines" USING btree ("tenant_id","pipeline_id");--> statement-breakpoint
CREATE INDEX "leads_tenant_stage_idx" ON "leads" USING btree ("tenant_id","stage_id");--> statement-breakpoint
CREATE INDEX "leads_tenant_pipeline_created_idx" ON "leads" USING btree ("tenant_id","pipeline_id","created_at","id");--> statement-breakpoint
CREATE INDEX "leads_tenant_contact_idx" ON "leads" USING btree ("tenant_id","contact_id");--> statement-breakpoint
CREATE INDEX "leads_tenant_owner_idx" ON "leads" USING btree ("tenant_id","owner_user_id");
