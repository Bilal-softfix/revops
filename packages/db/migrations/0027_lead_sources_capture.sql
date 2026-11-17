-- M2-T1: lead sources get a public key (public form / webhook URLs; the volatile default gives
-- each existing row its own random 64-hex key, new API-created keys are 32-byte base64url), a
-- capture config, an envelope-encrypted webhook secret (api sources) and soft delete.
ALTER TABLE "lead_sources" ADD COLUMN "public_key" text DEFAULT replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '') NOT NULL;--> statement-breakpoint
ALTER TABLE "lead_sources" ADD COLUMN "config" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "lead_sources" ADD COLUMN "webhook_secret_enc" text;--> statement-breakpoint
ALTER TABLE "lead_sources" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "lead_sources_public_key_unique" ON "lead_sources" USING btree ("public_key");--> statement-breakpoint
CREATE UNIQUE INDEX "lead_sources_tenant_name_unique" ON "lead_sources" USING btree ("tenant_id",lower("name")) WHERE "lead_sources"."deleted_at" is null;