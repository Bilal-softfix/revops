# M7 — Meta Lead Ads Integration
**Depends on:** M6 (and approved Meta app permissions for go-live) · **Size:** M

## Goal
Tenants connect their Facebook Page/Ad account; Lead Ads submissions land in the CRM within seconds with campaign/ad set/ad/form attribution; source reports show cost per lead and cost per qualified lead by campaign.

## Tasks
**M7-T1 OAuth & token vault** — Meta login flow, page + ad account selection, long-lived token exchange, encrypted storage, expiry monitoring + reconnect prompts.
**M7-T2 Lead webhook** — app-level `leadgen` webhook subscription per page, signature verification, fetch lead by id, map form fields → contact/lead/custom fields (mapping UI per form), attribution (campaign/adset/ad/form ids + names).
**M7-T3 Backfill & reconciliation** — periodic poll of recent leads per form to catch missed webhooks; dedupe on Meta lead id.
**M7-T4 Campaign insights sync** — daily spend/impressions/clicks per campaign/adset/ad (read-only) into `ad_insights_daily`; join with leads/qualifications/won value for CPL, cost per qualified lead, ROAS where values exist.
**M7-T5 UI** — integration settings, form mapping, campaign performance report.
**M7-T6 Fake Meta adapter** for full local/e2e testing.

## Review checklist
- [ ] Works end-to-end with Meta's lead ads testing tool
- [ ] Token expiry → visible reconnect banner + no silent data loss
- [ ] No write access to campaigns requested in MVP (read + leads only)
