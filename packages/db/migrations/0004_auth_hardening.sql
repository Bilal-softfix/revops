-- M0-T4 security review follow-ups.

-- 1. users: column-level privileges for app_user.
--    SELECT leaves out password_hash: a "list team members" query can never return co-members'
--    hashes (login reads the hash only via auth_find_user_by_email). UPDATE is limited to profile and
--    credential columns: id and email can't be rewritten from request data.
REVOKE SELECT, UPDATE ON "users" FROM "app_user";
--> statement-breakpoint
GRANT SELECT ("id", "email", "name", "phone_e164", "email_verified_at", "created_at", "updated_at")
  ON "users" TO "app_user";
--> statement-breakpoint
GRANT UPDATE ("name", "phone_e164", "password_hash", "email_verified_at", "updated_at")
  ON "users" TO "app_user";
--> statement-breakpoint

-- 2. self_select (user-only context) covers only active memberships of active tenants, so a
--    disabled member or a suspended tenant isn't readable without a tenant context.
DROP POLICY "self_select" ON "memberships";
--> statement-breakpoint
CREATE POLICY "self_select" ON "memberships" AS PERMISSIVE FOR SELECT TO PUBLIC USING (
  nullif(current_setting('app.tenant_id', true), '')::uuid IS NULL
  AND "user_id" = nullif(current_setting('app.user_id', true), '')::uuid
  AND "status" = 'active'
);
--> statement-breakpoint
DROP POLICY "self_select" ON "tenants";
--> statement-breakpoint
CREATE POLICY "self_select" ON "tenants" AS PERMISSIVE FOR SELECT TO PUBLIC USING (
  nullif(current_setting('app.tenant_id', true), '')::uuid IS NULL
  AND "status" = 'active'
  AND EXISTS (
    SELECT 1 FROM "memberships" m
    WHERE m."tenant_id" = "tenants"."id"
      AND m."user_id" = nullif(current_setting('app.user_id', true), '')::uuid
      AND m."status" = 'active'
  )
);
