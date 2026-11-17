ALTER TYPE "public"."timeline_event_type" ADD VALUE 're_enquiry' BEFORE 'stage_changed';--> statement-breakpoint
CREATE TABLE "lead_ingestions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"source_id" uuid,
	"idempotency_key" text NOT NULL,
	"outcome" text,
	"lead_id" uuid,
	"contact_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lead_ingestions_tenant_key_unique" UNIQUE("tenant_id","idempotency_key"),
	CONSTRAINT "lead_ingestions_key_length" CHECK (length("lead_ingestions"."idempotency_key") between 1 and 300),
	CONSTRAINT "lead_ingestions_outcome" CHECK ("lead_ingestions"."outcome" in ('created', 'reenquiry'))
);
--> statement-breakpoint
ALTER TABLE "lead_ingestions" ADD CONSTRAINT "lead_ingestions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_ingestions" ADD CONSTRAINT "lead_ingestions_source_fk" FOREIGN KEY ("tenant_id","source_id") REFERENCES "public"."lead_sources"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_ingestions" ADD CONSTRAINT "lead_ingestions_lead_fk" FOREIGN KEY ("tenant_id","lead_id") REFERENCES "public"."leads"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_ingestions" ADD CONSTRAINT "lead_ingestions_contact_fk" FOREIGN KEY ("tenant_id","contact_id") REFERENCES "public"."contacts"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "lead_ingestions_lead_idx" ON "lead_ingestions" USING btree ("tenant_id","lead_id");