CREATE TYPE "public"."custom_field_entity" AS ENUM('contact', 'lead');--> statement-breakpoint
CREATE TYPE "public"."custom_field_type" AS ENUM('text', 'number', 'date', 'select', 'multiselect', 'bool');--> statement-breakpoint
CREATE TYPE "public"."lead_source_type" AS ENUM('web_form', 'api', 'csv', 'phone', 'whatsapp', 'meta', 'manual', 'walk_in');--> statement-breakpoint
CREATE TYPE "public"."stage_category" AS ENUM('open', 'won', 'lost');--> statement-breakpoint
CREATE TABLE "custom_field_defs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entity" "custom_field_entity" NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"type" "custom_field_type" NOT NULL,
	"options" jsonb,
	"required" boolean DEFAULT false NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "custom_field_defs_tenant_entity_key_unique" UNIQUE("tenant_id","entity","key")
);
--> statement-breakpoint
CREATE TABLE "lead_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"key" text,
	"name" text NOT NULL,
	"type" "lead_source_type" NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lead_sources_tenant_id_id_unique" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "pipeline_stages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"pipeline_id" uuid NOT NULL,
	"key" text,
	"name" text NOT NULL,
	"position" integer NOT NULL,
	"category" "stage_category" NOT NULL,
	"probability" smallint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pipeline_stages_tenant_id_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "pipeline_stages_probability_range" CHECK ("pipeline_stages"."probability" between 0 and 100)
);
--> statement-breakpoint
CREATE TABLE "pipelines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"key" text,
	"name" text NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"lost_reasons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pipelines_tenant_id_id_unique" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "custom_field_defs" ADD CONSTRAINT "custom_field_defs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_sources" ADD CONSTRAINT "lead_sources_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_stages" ADD CONSTRAINT "pipeline_stages_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_stages" ADD CONSTRAINT "pipeline_stages_pipeline_fk" FOREIGN KEY ("tenant_id","pipeline_id") REFERENCES "public"."pipelines"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipelines" ADD CONSTRAINT "pipelines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "lead_sources_tenant_key_unique" ON "lead_sources" USING btree ("tenant_id","key") WHERE "lead_sources"."key" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "pipeline_stages_pipeline_key_unique" ON "pipeline_stages" USING btree ("pipeline_id","key") WHERE "pipeline_stages"."key" is not null;--> statement-breakpoint
CREATE INDEX "pipeline_stages_pipeline_position_idx" ON "pipeline_stages" USING btree ("pipeline_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "pipelines_one_default" ON "pipelines" USING btree ("tenant_id") WHERE "pipelines"."is_default" and "pipelines"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "pipelines_tenant_key_unique" ON "pipelines" USING btree ("tenant_id","key") WHERE "pipelines"."key" is not null;