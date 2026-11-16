import { Injectable } from '@nestjs/common';
import {
  type SQL,
  type Tx,
  and,
  asc,
  contacts,
  desc,
  eq,
  isNull,
  leads,
  notes,
  sql,
  tasks,
  timelineEvents,
  users,
} from '@revops/db';
import type { ActorType, TaskStatus, TaskType, TimelineEventType } from '@revops/shared';
import type { LeadScope } from './leads.repository';

export type NoteRow = typeof notes.$inferSelect;
export type TaskRow = typeof tasks.$inferSelect;

export interface NoteRecord {
  note: NoteRow;
  author: { id: string; name: string } | null;
}
export interface TaskRecord {
  task: TaskRow;
  contactName: string;
  assignee: { id: string; name: string } | null;
}
export interface TimelineRecord {
  event: typeof timelineEvents.$inferSelect;
  actor: { id: string; name: string } | null;
  note: NoteRecord | null;
}

export interface TimelineEntry {
  tenantId: string;
  leadId: string;
  contactId: string;
  type: TimelineEventType;
  actorType: ActorType;
  actorId: string | null;
  refTable?: string;
  refId?: string;
  summary?: string;
  data?: Record<string, unknown>;
  occurredAt: Date;
}

const ref = (id: string | null, name: string | null) => (id ? { id, name: name ?? '' } : null);

/** SQL for notes, tasks and timeline events; tenant transaction (RLS) from the caller. */
@Injectable()
export class ActivitiesRepository {
  /** Leads the scope may see — the same rule as LeadsRepository, applied through the lead. */
  private leadVisible(scope: LeadScope): SQL | undefined {
    return scope.all ? undefined : eq(leads.ownerUserId, scope.userId);
  }

  // ---- timeline ----

  async insertTimeline(tx: Tx, entries: readonly TimelineEntry[]): Promise<void> {
    if (entries.length === 0) return;
    await tx.insert(timelineEvents).values(
      entries.map((e) => ({
        tenantId: e.tenantId,
        leadId: e.leadId,
        contactId: e.contactId,
        type: e.type,
        actorType: e.actorType,
        actorId: e.actorId,
        refTable: e.refTable ?? null,
        refId: e.refId ?? null,
        summary: e.summary ?? null,
        data: e.data ?? {},
        occurredAt: e.occurredAt,
      })),
    );
  }

  /** Newest first, ties in write order; keyset cursor on (occurred_at, seq). Deleted notes hidden. */
  async timeline(
    tx: Tx,
    leadId: string,
    page: { limit: number; cursor?: string | undefined },
  ): Promise<TimelineRecord[]> {
    const author = sql`author`;
    const rows = await tx
      .select({
        event: timelineEvents,
        actorName: users.name,
        note: notes,
        authorName: sql<string | null>`${author}.name`,
      })
      .from(timelineEvents)
      .leftJoin(users, eq(users.id, timelineEvents.actorId))
      .leftJoin(
        notes,
        and(eq(timelineEvents.refTable, 'notes'), eq(notes.id, timelineEvents.refId)),
      )
      .leftJoin(sql`users as ${author}`, sql`${author}.id = ${notes.authorId}`)
      .where(
        and(
          eq(timelineEvents.leadId, leadId),
          // A note entry whose note was deleted disappears with it.
          sql`not (${timelineEvents.type} = 'note' and (${notes.id} is null or ${notes.deletedAt} is not null))`,
          page.cursor
            ? sql`(${timelineEvents.occurredAt}, ${timelineEvents.seq}) < (select e.occurred_at, e.seq from timeline_events e where e.id = ${page.cursor})`
            : undefined,
        ),
      )
      .orderBy(desc(timelineEvents.occurredAt), desc(timelineEvents.seq))
      .limit(page.limit);
    return rows.map((r) => ({
      event: r.event,
      actor: ref(r.event.actorId, r.actorName),
      note: r.note ? { note: r.note, author: ref(r.note.authorId, r.authorName) } : null,
    }));
  }

  // ---- notes ----

  async insertNote(
    tx: Tx,
    values: { tenantId: string; leadId: string; authorId: string; body: string },
  ): Promise<NoteRow> {
    const [row] = await tx.insert(notes).values(values).returning();
    if (!row) throw new Error('note insert returned nothing');
    return row;
  }

  /** A live note on a live lead the scope can see, locked for an edit/delete. */
  async lockVisibleNote(tx: Tx, scope: LeadScope, id: string): Promise<NoteRow | undefined> {
    const [row] = await tx
      .select({ note: notes })
      .from(notes)
      .innerJoin(leads, eq(leads.id, notes.leadId))
      .where(
        and(
          eq(notes.id, id),
          isNull(notes.deletedAt),
          isNull(leads.deletedAt),
          this.leadVisible(scope),
        ),
      )
      .for('update', { of: notes });
    return row?.note;
  }

  async findNote(tx: Tx, id: string): Promise<NoteRecord | undefined> {
    const [row] = await tx
      .select({ note: notes, authorName: users.name })
      .from(notes)
      .leftJoin(users, eq(users.id, notes.authorId))
      .where(eq(notes.id, id));
    return row ? { note: row.note, author: ref(row.note.authorId, row.authorName) } : undefined;
  }

  async updateNote(
    tx: Tx,
    id: string,
    patch: { body?: string; editedAt?: Date; deletedAt?: Date },
  ): Promise<void> {
    await tx.update(notes).set(patch).where(eq(notes.id, id));
  }

  // ---- tasks ----

  private taskQuery(tx: Tx) {
    return tx
      .select({ task: tasks, contactName: contacts.name, assigneeName: users.name })
      .from(tasks)
      .innerJoin(leads, eq(leads.id, tasks.leadId))
      .innerJoin(contacts, eq(contacts.id, leads.contactId))
      .leftJoin(users, eq(users.id, tasks.assigneeId));
  }

  private toTask(r: { task: TaskRow; contactName: string; assigneeName: string | null }) {
    return {
      task: r.task,
      contactName: r.contactName,
      assignee: ref(r.task.assigneeId, r.assigneeName),
    };
  }

  async insertTask(
    tx: Tx,
    values: {
      tenantId: string;
      leadId: string;
      assigneeId: string;
      title: string;
      type: TaskType;
      dueAt: Date;
      createdBy: string;
    },
  ): Promise<TaskRow> {
    const [row] = await tx.insert(tasks).values(values).returning();
    if (!row) throw new Error('task insert returned nothing');
    return row;
  }

  async findTask(tx: Tx, id: string): Promise<TaskRecord | undefined> {
    const [row] = await this.taskQuery(tx).where(eq(tasks.id, id));
    return row ? this.toTask(row) : undefined;
  }

  /** A live task on a live lead the scope can see, locked for an update/delete. */
  async lockVisibleTask(tx: Tx, scope: LeadScope, id: string): Promise<TaskRow | undefined> {
    const [row] = await tx
      .select({ task: tasks })
      .from(tasks)
      .innerJoin(leads, eq(leads.id, tasks.leadId))
      .where(
        and(
          eq(tasks.id, id),
          isNull(tasks.deletedAt),
          isNull(leads.deletedAt),
          this.leadVisible(scope),
        ),
      )
      .for('update', { of: tasks });
    return row?.task;
  }

  async updateTask(
    tx: Tx,
    id: string,
    patch: Partial<{
      title: string;
      type: TaskType;
      dueAt: Date;
      assigneeId: string;
      status: TaskStatus;
      completedAt: Date | null;
      deletedAt: Date;
    }>,
  ): Promise<void> {
    if (Object.keys(patch).length === 0) return; // e.g. completing an already-done task
    await tx.update(tasks).set(patch).where(eq(tasks.id, id));
  }

  /** A lead's live tasks: open ones by due date, then done ones (latest first). Capped. */
  async tasksOfLead(tx: Tx, leadId: string, limit: number): Promise<TaskRecord[]> {
    const rows = await this.taskQuery(tx)
      .where(and(eq(tasks.leadId, leadId), isNull(tasks.deletedAt)))
      .orderBy(
        sql`${tasks.status} = 'done'`,
        sql`case when ${tasks.status} = 'open' then ${tasks.dueAt} end asc`,
        desc(tasks.completedAt),
        asc(tasks.id),
      )
      .limit(limit);
    return rows.map((r) => this.toTask(r));
  }

  private bucketCondition(
    bucket: 'overdue' | 'today' | 'upcoming',
    now: Date,
    startOfTomorrow: Date,
  ): SQL {
    // ISO strings: raw sql params aren't serialised from Date by the driver.
    const nowIso = now.toISOString();
    const tomorrowIso = startOfTomorrow.toISOString();
    if (bucket === 'overdue') return sql`${tasks.dueAt} < ${nowIso}`;
    if (bucket === 'today') {
      return sql`${tasks.dueAt} >= ${nowIso} and ${tasks.dueAt} < ${tomorrowIso}`;
    }
    return sql`${tasks.dueAt} >= ${tomorrowIso}`;
  }

  private myTaskConditions(scope: LeadScope, userId: string): (SQL | undefined)[] {
    return [
      eq(tasks.assigneeId, userId),
      eq(tasks.status, 'open'),
      isNull(tasks.deletedAt),
      isNull(leads.deletedAt),
      // Only tasks on leads the caller can (still) see.
      this.leadVisible(scope),
    ];
  }

  /** Open tasks assigned to `userId` in one bucket, by due date; keyset cursor on (due_at, id). */
  async myTasks(
    tx: Tx,
    scope: LeadScope,
    userId: string,
    bucket: 'overdue' | 'today' | 'upcoming',
    bounds: { now: Date; startOfTomorrow: Date },
    page: { limit: number; cursor?: string | undefined },
  ): Promise<TaskRecord[]> {
    const rows = await this.taskQuery(tx)
      .where(
        and(
          ...this.myTaskConditions(scope, userId),
          this.bucketCondition(bucket, bounds.now, bounds.startOfTomorrow),
          page.cursor
            ? sql`(${tasks.dueAt}, ${tasks.id}) > (select t.due_at, t.id from tasks t where t.id = ${page.cursor})`
            : undefined,
        ),
      )
      .orderBy(asc(tasks.dueAt), asc(tasks.id))
      .limit(page.limit);
    return rows.map((r) => this.toTask(r));
  }

  async myTaskCounts(
    tx: Tx,
    scope: LeadScope,
    userId: string,
    bounds: { now: Date; startOfTomorrow: Date },
  ): Promise<{ overdue: number; today: number; upcoming: number }> {
    const { now, startOfTomorrow } = bounds;
    const [row] = await tx
      .select({
        overdue: sql<number>`count(*) filter (where ${this.bucketCondition('overdue', now, startOfTomorrow)})::int`,
        today: sql<number>`count(*) filter (where ${this.bucketCondition('today', now, startOfTomorrow)})::int`,
        upcoming: sql<number>`count(*) filter (where ${this.bucketCondition('upcoming', now, startOfTomorrow)})::int`,
      })
      .from(tasks)
      .innerJoin(leads, eq(leads.id, tasks.leadId))
      .where(and(...this.myTaskConditions(scope, userId)));
    return row ?? { overdue: 0, today: 0, upcoming: 0 };
  }
}
