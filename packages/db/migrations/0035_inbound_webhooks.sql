CREATE TABLE "inbound_webhooks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"source_id" uuid NOT NULL,
	"provider" text DEFAULT 'generic' NOT NULL,
	"external_event_id" text,
	"signature_valid" boolean NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text NOT NULL,
	"error" text,
	"lead_id" uuid,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	CONSTRAINT "inbound_webhooks_status" CHECK ("inbound_webhooks"."status" in ('received', 'processed', 'failed', 'rejected')),
	CONSTRAINT "inbound_webhooks_event_id_length" CHECK (length("inbound_webhooks"."external_event_id") between 1 and 200)
);
--> statement-breakpoint
ALTER TABLE "inbound_webhooks" ADD CONSTRAINT "inbound_webhooks_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbound_webhooks" ADD CONSTRAINT "inbound_webhooks_source_fk" FOREIGN KEY ("tenant_id","source_id") REFERENCES "public"."lead_sources"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbound_webhooks" ADD CONSTRAINT "inbound_webhooks_lead_fk" FOREIGN KEY ("tenant_id","lead_id") REFERENCES "public"."leads"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "inbound_webhooks_event_unique" ON "inbound_webhooks" USING btree ("tenant_id","source_id","external_event_id") WHERE "inbound_webhooks"."signature_valid" and "inbound_webhooks"."external_event_id" is not null;--> statement-breakpoint
CREATE INDEX "inbound_webhooks_received_idx" ON "inbound_webhooks" USING btree ("received_at");