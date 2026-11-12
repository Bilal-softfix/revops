# 02 — Data Model (core, MVP)

All tables: `id uuid pk default gen_random_uuid()`, `created_at`, `updated_at timestamptz`. Tenant tables also `tenant_id uuid not null references tenants` + RLS. Soft delete (`deleted_at`) only where noted.

## Identity & tenancy
- **tenants** — name, slug, timezone (default Asia/Kolkata), locale, industry_template, parent_tenant_id (nullable, future agency), settings jsonb, status
- **users** (global, no tenant_id; RLS: self + members of the current tenant; unverified accounts expire 48 h after created_at and are purged with their sole-owned tenants) — email (unique, citext), name, phone_e164, password_hash (argon2id, nullable until set), email_verified_at
- **memberships** — tenant_id, user_id, role, status (invited/active/disabled); unique(tenant_id,user_id)
- **sessions** (global, user-scoped RLS) — user_id, token_hash (sha256, unique), active_tenant_id, ip, user_agent, created_at, last_seen_at, expires_at (created + 30d), revoked_at
- **auth_tokens** (global, user-scoped RLS) — user_id, purpose (email_verify/password_reset), token_hash (unique), expires_at, used_at (single use, consumed atomically inside `auth_verify_email` / `auth_reset_password`)
- **invitations** (tenant, FORCE RLS) — email (citext), role, token_hash (sha256 of `<tenant_id>.<random>`, unique), invited_by, expires_at (7 d), accepted_at, revoked_at; unique(tenant_id, email) where open
- **business_hours** — tenant_id, weekday, open_time, close_time; **holidays** — tenant_id, date
- **audit_logs** (append-only: app_user has SELECT + INSERT only; created_at, no updated_at) — tenant_id, actor_type (user/ai/system), actor_id, action, entity, entity_id (text), before/after jsonb, ip inet

## CRM
- **contacts** — name, phone_e164, alt_phones text[], email, city, custom_fields jsonb, consent jsonb (whatsapp/sms/call/recording with timestamps + source), deleted_at. Index: unique(tenant_id, phone_e164) where deleted_at is null; (tenant_id, email)
- **pipelines** — name, is_default; **pipeline_stages** — pipeline_id, name, position, category (open/won/lost), probability
- **leads** — contact_id, pipeline_id, stage_id, owner_user_id, status, score (nullable, post-MVP), value_paise bigint, currency default 'INR', source_id, attribution jsonb (utm_*, gclid, fbclid, meta campaign/adset/ad/form ids, landing_url, referrer), first_response_at, qualified_at, won_at, lost_reason, custom_fields jsonb
- **custom_field_defs** — entity (contact/lead), key, label, type (text/number/date/select/multiselect/bool), options jsonb, required
- **notes** — lead_id, author_id, body; **tasks** — lead_id, assignee_id, type (call/followup/meeting/other), due_at, status, completed_at
- **timeline_events** — lead_id, contact_id, type (created/stage_changed/call/message/note/task/qualification/assignment), ref_table, ref_id, summary, occurred_at. Index (tenant_id, lead_id, occurred_at desc)

## Capture
- **lead_sources** — type (web_form/api/csv/phone/whatsapp/meta/manual), name, config jsonb, public_key (for form embed), is_active
- **inbound_webhooks** — provider, external_event_id, signature_valid, payload jsonb, status, error, processed_at; unique(provider, external_event_id)
- **imports** — file_key, status, totals jsonb, error_report_key

## Telephony & conversations
- **phone_numbers** — e164, provider, provider_ref, label, routing_rule_id
- **routing_rules** — name, strategy (sequential/simultaneous), ring_timeout_sec, members jsonb [user_id, order], after_hours_action (ai/voicemail), no_answer_action (ai/voicemail), ai_playbook_id
- **call_sessions** — lead_id, contact_id, phone_number_id, direction, from_e164, to_e164, status (ringing/human_answered/ai_answered/missed/voicemail/completed/failed), answered_by_user_id, handled_by (human/ai/none), started_at, answered_at, ended_at, duration_sec, recording_key, provider_call_id unique, cost_paise
- **transcripts** — call_session_id, segments jsonb [{speaker, start_ms, end_ms, text, lang}], language
- **qualifications** — call_session_id, lead_id, answers jsonb (per playbook questions), intent, budget, timeline, next_step, confidence, summary, created_by (ai/user)
- **ai_playbooks** — name, language_prefs, greeting, persona, questions jsonb, faq_kb_id, escalation_rules jsonb, voice config jsonb, version, is_active
- **kb_documents** / **kb_chunks** — chunk text, embedding vector(dim), metadata

## Automation & messaging
- **automation_rules** — name, trigger_event, conditions jsonb (simple AND/OR tree), actions jsonb [{type: assign/create_task/send_whatsapp/change_stage/notify, params}], is_active
- **automation_runs** — rule_id, event_id, status, error, unique(rule_id, event_id)
- **message_templates** — channel, provider_template_name, language, variables, approval_status
- **messages** — lead_id, contact_id, channel, direction, template_id, body, status (queued/sent/delivered/read/failed), provider_message_id, cost_paise

## Usage & integrations
- **usage_events** — type (call_minute/ai_minute/stt_sec/tts_char/llm_token/whatsapp_msg/sms/storage_gb_day), quantity numeric, unit_cost_paise, ref_table, ref_id, occurred_at
- **tenant_limits** — type, monthly_cap, alert_threshold_pct
- **integration_accounts** — provider (meta/google_ads), external_account_id, encrypted_tokens bytea, scopes, status, expires_at, last_sync_at
- **ad_insights_daily** — integration_account_id, level (campaign/adset/ad), external_id, name, date, spend_paise, impressions, clicks (M7)
- **rate_limit_buckets** (system table, ADR-011: no tenant_id; RLS enabled with no policies and no app_user grants, reached only via the definer functions `rate_limit_consume/reset/purge`) — key_hash (sha256 hex of the logical key, pk), count, reset_at. Index on reset_at for purging
- **pgboss.*** (M0-T6, migration 0013: separate `pgboss` schema installed and owned by the owner role, pg-boss 12.38.0 schema v46). Holds the pg-boss job, queue and schedule tables. The app never queries them directly, so there is no RLS. `app_user` has USAGE plus DML and EXECUTE only, and no DDL. Payloads carry ids such as tenantId and never secrets.
- **processed_events** (M0-T6, tenant table, FORCE RLS, append-only for app_user)
  - Columns: consumer, event_id, tenant_id, processed_at.
  - PK (consumer, event_id); index on tenant_id; cascades with the tenant.
  - Consumer idempotency: inserted in the same transaction as the consumer's side effects (`processOnce`).
- **outbox_events** (created/occurred_at only) — tenant_id, type (versioned, e.g. `lead.created.v1`), aggregate_id, payload jsonb, occurred_at, published_at, dead_lettered_at, dead_letter_reason (M1-T0); CHECKs on the type format and payload being an object; partial index `outbox_events_pending_idx` on rows neither published nor dead-lettered. The relay reads it across tenants only via `outbox_claim_batch` / `outbox_mark_published` (SECURITY DEFINER, migration 0012) and two owner-only policies (`outbox_relay_select` / `outbox_relay_update`, `TO` the owner role). See architecture
