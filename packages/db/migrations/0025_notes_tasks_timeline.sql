CREATE TYPE "public"."task_status" AS ENUM('open', 'done');--> statement-breakpoint
CREATE TYPE "public"."task_type" AS ENUM('call', 'followup', 'meeting', 'other');--> statement-breakpoint
CREATE TYPE "public"."timeline_event_type" AS ENUM('created', 'stage_changed', 'assignment', 'note', 'task', 'call', 'message', 'qualification');--> statement-breakpoint
CREATE TABLE "notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"lead_id" uuid NOT NULL,
	"author_id" uuid,
	"body" text NOT NULL,
	"edited_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notes_body_length" CHECK (char_length("notes"."body") between 1 and 10000)
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"lead_id" uuid NOT NULL,
	"assignee_id" uuid,
	"title" text NOT NULL,
	"type" "task_type" DEFAULT 'followup' NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"status" "task_status" DEFAULT 'open' NOT NULL,
	"completed_at" timestamp with time zone,
	"created_by" uuid,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tasks_title_length" CHECK (char_length("tasks"."title") between 1 and 200),
	CONSTRAINT "tasks_completed_iff_done" CHECK (("tasks"."status" = 'done') = ("tasks"."completed_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "timeline_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seq" bigint GENERATED ALWAYS AS IDENTITY (sequence name "timeline_events_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"tenant_id" uuid NOT NULL,
	"lead_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"type" timeline_event_type NOT NULL,
	"actor_type" "actor_type" NOT NULL,
	"actor_id" uuid,
	"ref_table" text,
	"ref_id" uuid,
	"summary" text,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_lead_fk" FOREIGN KEY ("tenant_id","lead_id") REFERENCES "public"."leads"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assignee_id_users_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_lead_fk" FOREIGN KEY ("tenant_id","lead_id") REFERENCES "public"."leads"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timeline_events" ADD CONSTRAINT "timeline_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timeline_events" ADD CONSTRAINT "timeline_events_lead_fk" FOREIGN KEY ("tenant_id","lead_id") REFERENCES "public"."leads"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timeline_events" ADD CONSTRAINT "timeline_events_contact_fk" FOREIGN KEY ("tenant_id","contact_id") REFERENCES "public"."contacts"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notes_tenant_lead_idx" ON "notes" USING btree ("tenant_id","lead_id");--> statement-breakpoint
CREATE INDEX "tasks_tenant_lead_idx" ON "tasks" USING btree ("tenant_id","lead_id");--> statement-breakpoint
CREATE INDEX "tasks_tenant_assignee_due_idx" ON "tasks" USING btree ("tenant_id","assignee_id","status","due_at","id");--> statement-breakpoint
CREATE INDEX "timeline_events_lead_idx" ON "timeline_events" USING btree ("tenant_id","lead_id","occurred_at" desc,"seq" desc);