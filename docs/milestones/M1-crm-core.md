# M1 — CRM Core
**Depends on:** M0 · **Size:** L

## Goal
Agents and managers can manage contacts and leads through configurable pipelines with a complete, chronological timeline.

## Out of scope
Lead capture channels (M2), calls (M3), automation (M5), scoring.

## Tasks
**M1-T1 Contacts** — CRUD, phone normalisation to E.164 (libphonenumber, default region IN: handles `09876543210`, `+91 98765 43210`, `98765-43210`), alt phones, email, consent jsonb, soft delete, search (name/phone/email) with trigram index.
- AC: duplicate phone within tenant rejected with conflict error pointing at existing contact; same phone allowed across tenants.

**M1-T2 Custom fields** — definitions for contact/lead (text, number, date, select, multiselect, bool); validation of values against defs; render dynamically in forms.
- AC: invalid value types rejected with field-level errors; deleting a def hides (not destroys) stored values.

**M1-T3 Pipelines & stages** — default pipeline seeded from tenant's industry template JSON (`packages/shared/templates/{real-estate,education,clinic,generic}.json`); CRUD + reorder stages; stage category open/won/lost.
- AC: cannot delete a stage with leads without choosing a target stage (bulk move).

**M1-T4 Leads** — create/edit, owner assignment, stage change (records won_at/lost reason), value in paise, attribution jsonb, status; list view with filters (stage, owner, source, date range, custom fields), saved views, cursor pagination; kanban board with drag-drop stage change; agents see only assigned leads unless permission.
- AC: stage change emits `lead.stage_changed.v1` via outbox; agent can't fetch unassigned lead by id (403/404).

**M1-T5 Notes, tasks, timeline** — notes; tasks with due date/assignee/type and "My tasks" view (overdue/today/upcoming); timeline_events written for create, assignment, stage change, note, task completion; lead detail page with timeline + side panel.
- AC: timeline is ordered, paginated, and shows actor (user/ai/system).

**M1-T6 Audit + bulk actions** — audit log for assignment/stage/delete; bulk assign, bulk stage move, CSV export (with formula-injection escaping) — permissioned.
- AC: export respects agent visibility; audit entries created for bulk actions.

## Kickoff prompt
```
/start-milestone M1
The segment is not decided, so nothing industry-specific may be hardcoded — industry differences live only in the template JSON files and custom fields.
```

## Review checklist
- [ ] Indian phone formats normalise correctly (tests for at least 8 variants)
- [ ] List & kanban usable with 10k leads (seed + quick check of query plans)
- [ ] Every tenant table has leak test
- [ ] Agent visibility enforced in API, not just UI
