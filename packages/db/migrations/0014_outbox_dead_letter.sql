DROP INDEX "outbox_events_unpublished_idx";--> statement-breakpoint
ALTER TABLE "outbox_events" ADD COLUMN "dead_lettered_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "outbox_events" ADD COLUMN "dead_letter_reason" text;--> statement-breakpoint
CREATE INDEX "outbox_events_pending_idx" ON "outbox_events" USING btree ("occurred_at") WHERE "outbox_events"."published_at" is null and "outbox_events"."dead_lettered_at" is null;--> statement-breakpoint
ALTER TABLE "outbox_events" ADD CONSTRAINT "outbox_events_type_format" CHECK ("outbox_events"."type" ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+\.v[1-9][0-9]*$');--> statement-breakpoint
ALTER TABLE "outbox_events" ADD CONSTRAINT "outbox_events_payload_object" CHECK (jsonb_typeof("outbox_events"."payload") = 'object');