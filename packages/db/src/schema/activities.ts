import { desc, sql } from 'drizzle-orm';
import {
  bigint,
  check,
  foreignKey,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, id, timestamps } from './columns.js';
import { contacts } from './contacts.js';
import { actorType, taskStatus, taskType, timelineEventType } from './enums.js';
import { leads } from './leads.js';
import { tenants } from './tenants.js';
import { users } from './users.js';

/**
 * Notes, tasks and the lead timeline (M1-T5, docs/02-data-model.md). Each row points at a lead of
 * the same tenant through a composite (tenant_id, lead_id) FK. Notes and tasks are soft-deleted.
 */
export const notes = pgTable(
  'notes',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    leadId: uuid('lead_id').notNull(),
    authorId: uuid('author_id').references(() => users.id, { onDelete: 'set null' }),
    body: text('body').notNull(),
    editedAt: timestamp('edited_at', { withTimezone: true }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [
    foreignKey({
      name: 'notes_lead_fk',
      columns: [t.tenantId, t.leadId],
      foreignColumns: [leads.tenantId, leads.id],
    }).onDelete('cascade'),
    index('notes_tenant_lead_idx').on(t.tenantId, t.leadId),
    check('notes_body_length', sql`char_length(${t.body}) between 1 and 10000`),
  ],
);

export const tasks = pgTable(
  'tasks',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    leadId: uuid('lead_id').notNull(),
    assigneeId: uuid('assignee_id').references(() => users.id, { onDelete: 'set null' }),
    title: text('title').notNull(),
    type: taskType('type').notNull().default('followup'),
    dueAt: timestamp('due_at', { withTimezone: true }).notNull(),
    status: taskStatus('status').notNull().default('open'),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [
    foreignKey({
      name: 'tasks_lead_fk',
      columns: [t.tenantId, t.leadId],
      foreignColumns: [leads.tenantId, leads.id],
    }).onDelete('cascade'),
    index('tasks_tenant_lead_idx').on(t.tenantId, t.leadId),
    // "My tasks": open tasks of one assignee by due date.
    index('tasks_tenant_assignee_due_idx').on(t.tenantId, t.assigneeId, t.status, t.dueAt, t.id),
    check('tasks_title_length', sql`char_length(${t.title}) between 1 and 200`),
    check('tasks_completed_iff_done', sql`(${t.status} = 'done') = (${t.completedAt} is not null)`),
  ],
);

/**
 * Append-only history of a lead (app_user: SELECT + INSERT). `seq` breaks ties between events
 * of the same instant, so the order is the order they were written. `data` holds snapshots
 * (stage / user names as they were); a `note` entry shows the live note via ref_id.
 */
export const timelineEvents = pgTable(
  'timeline_events',
  {
    id: id(),
    seq: bigint('seq', { mode: 'number' }).generatedAlwaysAsIdentity().notNull(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    leadId: uuid('lead_id').notNull(),
    contactId: uuid('contact_id').notNull(),
    type: timelineEventType('type').notNull(),
    actorType: actorType('actor_type').notNull(),
    /** User id for `user`; null for `system` / `ai`. */
    actorId: uuid('actor_id'),
    refTable: text('ref_table'),
    refId: uuid('ref_id'),
    summary: text('summary'),
    data: jsonb('data').$type<Record<string, unknown>>().notNull().default({}),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      name: 'timeline_events_lead_fk',
      columns: [t.tenantId, t.leadId],
      foreignColumns: [leads.tenantId, leads.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'timeline_events_contact_fk',
      columns: [t.tenantId, t.contactId],
      foreignColumns: [contacts.tenantId, contacts.id],
    }),
    index('timeline_events_lead_idx').on(t.tenantId, t.leadId, desc(t.occurredAt), desc(t.seq)),
  ],
);
