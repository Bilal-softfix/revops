CREATE TABLE "saved_views" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"entity" text DEFAULT 'lead' NOT NULL,
	"name" text NOT NULL,
	"layout" text DEFAULT 'list' NOT NULL,
	"filters" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "saved_views_user_name_unique" UNIQUE("tenant_id","user_id","entity","name"),
	CONSTRAINT "saved_views_layout" CHECK ("saved_views"."layout" in ('list', 'board'))
);
--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "status" "stage_category" DEFAULT 'open' NOT NULL;--> statement-breakpoint
ALTER TABLE "saved_views" ADD CONSTRAINT "saved_views_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_views" ADD CONSTRAINT "saved_views_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "leads_tenant_created_idx" ON "leads" USING btree ("tenant_id","created_at","id");--> statement-breakpoint
CREATE INDEX "leads_custom_fields_gin_idx" ON "leads" USING gin ("custom_fields" jsonb_path_ops);