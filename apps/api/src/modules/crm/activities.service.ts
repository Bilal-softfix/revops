import { Injectable } from '@nestjs/common';
import type { Tx } from '@revops/db';
import {
  type CreateNoteRequest,
  type CreateTaskRequest,
  DEFAULT_TIMEZONE,
  type MyTasksQuery,
  type Note,
  type Task,
  type TaskCounts,
  type TaskList,
  type TaskPage,
  type TimelinePage,
  type TimelineQuery,
  type UpdateNoteRequest,
  type UpdateTaskRequest,
  dayBounds,
  hasPermission,
  timelineDataSchema,
} from '@revops/shared';
import { Clock } from '../../platform/clock';
import { DomainError } from '../../platform/errors/domain-error';
import { recordAudit } from '../../platform/outbox/record';
import type { RequestMeta } from '../../platform/request-meta';
import {
  ActivitiesRepository,
  type NoteRecord,
  type TaskRecord,
  type TaskRow,
} from './activities.repository';
import { type CrmAuth, CrmService } from './crm.service';
import { crmNotFound } from './errors';
import { type LeadRow, LeadsRepository } from './leads.repository';
import { LeadsService } from './leads.service';

const invalid = (errors: { path: string; message: string }[]) =>
  new DomainError('validation_failed', 400, 'Invalid request', { extensions: { errors } });
const forbidden = (title: string) => new DomainError('forbidden', 403, title);

/** Most tasks a lead page lists (open first). */
const LEAD_TASK_LIMIT = 100;

const toNote = ({ note, author }: NoteRecord): Note => ({
  id: note.id,
  leadId: note.leadId,
  body: note.body,
  author,
  createdAt: note.createdAt.toISOString(),
  editedAt: note.editedAt?.toISOString() ?? null,
});

const toTask = ({ task, contactName, assignee }: TaskRecord): Task => ({
  id: task.id,
  lead: { id: task.leadId, contactName },
  title: task.title,
  type: task.type,
  dueAt: task.dueAt.toISOString(),
  status: task.status,
  completedAt: task.completedAt?.toISOString() ?? null,
  assignee,
  createdAt: task.createdAt.toISOString(),
});

/**
 * Notes, tasks and the lead timeline (M1-T5). Everything hangs off a lead and follows its
 * visibility: a lead the caller can't see makes its notes/tasks/timeline 404.
 *
 * - Notes: anyone who can see the lead adds them; only the author edits; the author or a
 *   `lead.delete` role deletes (soft; the timeline entry disappears with it).
 * - Tasks: assignee defaults to the caller; anyone else needs `lead.assign` and must be an active
 *   member who can see the lead. Completing / reopening writes a timeline entry.
 * - My tasks: open tasks assigned to me on leads I can see, bucketed in the tenant's timezone.
 */
@Injectable()
export class ActivitiesService {
  constructor(
    private readonly crm: CrmService,
    private readonly leads: LeadsService,
    private readonly leadsRepository: LeadsRepository,
    private readonly repository: ActivitiesRepository,
    private readonly clock: Clock,
  ) {}

  private async visibleLead(tx: Tx, auth: CrmAuth, leadId: string): Promise<LeadRow> {
    const lead = await this.leadsRepository.lockVisible(tx, this.leads.scope(auth), leadId);
    if (!lead) throw crmNotFound();
    return lead;
  }

  // ---- timeline ----

  timeline(auth: CrmAuth, leadId: string, query: TimelineQuery): Promise<TimelinePage> {
    return this.crm.withCrm(auth, async (tx) => {
      const record = await this.leadsRepository.findVisible(tx, this.leads.scope(auth), leadId);
      if (!record) throw crmNotFound();
      const rows = await this.repository.timeline(tx, leadId, {
        limit: query.limit + 1,
        cursor: query.cursor,
      });
      const page = rows.slice(0, query.limit);
      return {
        items: page.map((r) => ({
          id: r.event.id,
          type: r.event.type,
          occurredAt: r.event.occurredAt.toISOString(),
          actor: { type: r.event.actorType, user: r.actor },
          summary: r.event.summary,
          // Stored data is ours, but parse anyway: unknown keys are dropped, never leaked.
          data: timelineDataSchema.parse(r.event.data),
          ...(r.note ? { note: toNote(r.note) } : {}),
        })),
        nextCursor: rows.length > query.limit ? (page.at(-1)?.event.id ?? null) : null,
      };
    });
  }

  // ---- notes ----

  createNote(
    auth: CrmAuth,
    leadId: string,
    input: CreateNoteRequest,
    meta: RequestMeta,
  ): Promise<Note> {
    return this.crm.withCrm(auth, async (tx) => {
      const lead = await this.visibleLead(tx, auth, leadId);
      const note = await this.repository.insertNote(tx, {
        tenantId: auth.tenantId,
        leadId,
        authorId: auth.userId,
        body: input.body,
      });
      await this.repository.insertTimeline(tx, [
        {
          tenantId: auth.tenantId,
          leadId,
          contactId: lead.contactId,
          type: 'note',
          actorType: 'user',
          actorId: auth.userId,
          refTable: 'notes',
          refId: note.id,
          occurredAt: this.clock.now(),
        },
      ]);
      // Audit without the body: audit rows are not a second copy of what people wrote.
      await this.audit(tx, auth, meta, 'note.created', 'note', note.id, { leadId });
      return this.loadNote(tx, note.id);
    });
  }

  updateNote(
    auth: CrmAuth,
    id: string,
    input: UpdateNoteRequest,
    meta: RequestMeta,
  ): Promise<Note> {
    return this.crm.withCrm(auth, async (tx) => {
      const note = await this.repository.lockVisibleNote(tx, this.leads.scope(auth), id);
      if (!note) throw crmNotFound();
      if (note.authorId !== auth.userId) throw forbidden('Only the author can edit a note');
      await this.repository.updateNote(tx, id, { body: input.body, editedAt: this.clock.now() });
      await this.audit(tx, auth, meta, 'note.updated', 'note', id, { leadId: note.leadId });
      return this.loadNote(tx, id);
    });
  }

  async removeNote(auth: CrmAuth, id: string, meta: RequestMeta): Promise<void> {
    await this.crm.withCrm(auth, async (tx) => {
      const note = await this.repository.lockVisibleNote(tx, this.leads.scope(auth), id);
      if (!note) throw crmNotFound();
      if (note.authorId !== auth.userId && !hasPermission(auth.role, 'lead.delete')) {
        throw forbidden('Only the author or a manager can delete a note');
      }
      await this.repository.updateNote(tx, id, { deletedAt: this.clock.now() });
      await this.audit(tx, auth, meta, 'note.deleted', 'note', id, { leadId: note.leadId });
    });
  }

  private async loadNote(tx: Tx, id: string): Promise<Note> {
    const record = await this.repository.findNote(tx, id);
    if (!record) throw crmNotFound();
    return toNote(record);
  }

  // ---- tasks ----

  tasksOfLead(auth: CrmAuth, leadId: string): Promise<TaskList> {
    return this.crm.withCrm(auth, async (tx) => {
      const record = await this.leadsRepository.findVisible(tx, this.leads.scope(auth), leadId);
      if (!record) throw crmNotFound();
      const rows = await this.repository.tasksOfLead(tx, leadId, LEAD_TASK_LIMIT);
      return { items: rows.map(toTask) };
    });
  }

  createTask(
    auth: CrmAuth,
    leadId: string,
    input: CreateTaskRequest,
    meta: RequestMeta,
  ): Promise<Task> {
    return this.crm.withCrm(auth, async (tx) => {
      const lead = await this.visibleLead(tx, auth, leadId);
      const assigneeId = input.assigneeUserId ?? auth.userId;
      await this.checkAssignee(tx, auth, lead, assigneeId);
      const task = await this.repository.insertTask(tx, {
        tenantId: auth.tenantId,
        leadId,
        assigneeId,
        title: input.title,
        type: input.type,
        dueAt: new Date(input.dueAt),
        createdBy: auth.userId,
      });
      await this.audit(tx, auth, meta, 'task.created', 'task', task.id, {
        leadId,
        assigneeId,
        type: input.type,
      });
      return this.loadTask(tx, task.id);
    });
  }

  updateTask(
    auth: CrmAuth,
    id: string,
    input: UpdateTaskRequest,
    meta: RequestMeta,
  ): Promise<Task> {
    return this.crm.withCrm(auth, async (tx) => {
      const task = await this.repository.lockVisibleTask(tx, this.leads.scope(auth), id);
      if (!task) throw crmNotFound();
      const lead = await this.visibleLead(tx, auth, task.leadId);
      if (input.assigneeUserId !== undefined && input.assigneeUserId !== task.assigneeId) {
        await this.checkAssignee(tx, auth, lead, input.assigneeUserId);
      }
      const now = this.clock.now();
      const statusChanged = input.status !== undefined && input.status !== task.status;
      await this.repository.updateTask(tx, id, {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.type !== undefined ? { type: input.type } : {}),
        ...(input.dueAt !== undefined ? { dueAt: new Date(input.dueAt) } : {}),
        ...(input.assigneeUserId !== undefined ? { assigneeId: input.assigneeUserId } : {}),
        ...(statusChanged && input.status
          ? { status: input.status, completedAt: input.status === 'done' ? now : null }
          : {}),
      });
      if (statusChanged) await this.recordTaskStatus(tx, auth, lead, task, input, now);
      await this.audit(tx, auth, meta, 'task.updated', 'task', id, {
        leadId: task.leadId,
        fields: Object.keys(input).sort(),
        ...(statusChanged ? { status: input.status } : {}),
      });
      return this.loadTask(tx, id);
    });
  }

  async removeTask(auth: CrmAuth, id: string, meta: RequestMeta): Promise<void> {
    await this.crm.withCrm(auth, async (tx) => {
      const task = await this.repository.lockVisibleTask(tx, this.leads.scope(auth), id);
      if (!task) throw crmNotFound();
      await this.repository.updateTask(tx, id, { deletedAt: this.clock.now() });
      await this.audit(tx, auth, meta, 'task.deleted', 'task', id, { leadId: task.leadId });
    });
  }

  myTasks(auth: CrmAuth, query: MyTasksQuery): Promise<TaskPage> {
    return this.crm.withCrm(auth, async (tx) => {
      const rows = await this.repository.myTasks(
        tx,
        this.leads.scope(auth),
        auth.userId,
        query.bucket,
        this.bounds(),
        { limit: query.limit + 1, cursor: query.cursor },
      );
      const page = rows.slice(0, query.limit);
      return {
        items: page.map(toTask),
        nextCursor: rows.length > query.limit ? (page.at(-1)?.task.id ?? null) : null,
      };
    });
  }

  myTaskCounts(auth: CrmAuth): Promise<TaskCounts> {
    return this.crm.withCrm(auth, (tx) =>
      this.repository.myTaskCounts(tx, this.leads.scope(auth), auth.userId, this.bounds()),
    );
  }

  /** Bucket edges in the tenant's timezone (Asia/Kolkata until tenants choose one). */
  private bounds(): { now: Date; startOfTomorrow: Date } {
    const now = this.clock.now();
    return { now, startOfTomorrow: dayBounds(now, DEFAULT_TIMEZONE).startOfTomorrow };
  }

  /**
   * A task's assignee: the caller, or (with `lead.assign`) an active member who can see the
   * lead — so nobody gets a task they can't open.
   */
  private async checkAssignee(
    tx: Tx,
    auth: CrmAuth,
    lead: LeadRow,
    assigneeId: string,
  ): Promise<void> {
    if (assigneeId !== auth.userId && !hasPermission(auth.role, 'lead.assign')) {
      throw forbidden('You can’t assign tasks to someone else');
    }
    const role = await this.leadsRepository.activeMemberRole(tx, assigneeId);
    if (!role) {
      throw invalid([
        { path: 'assigneeUserId', message: 'not an active member of this workspace' },
      ]);
    }
    if (!hasPermission(role, 'lead.read.all') && lead.ownerUserId !== assigneeId) {
      throw invalid([{ path: 'assigneeUserId', message: 'this member can’t see this lead' }]);
    }
  }

  private recordTaskStatus(
    tx: Tx,
    auth: CrmAuth,
    lead: LeadRow,
    task: TaskRow,
    input: UpdateTaskRequest,
    now: Date,
  ): Promise<void> {
    return this.repository.insertTimeline(tx, [
      {
        tenantId: auth.tenantId,
        leadId: lead.id,
        contactId: lead.contactId,
        type: 'task',
        actorType: 'user',
        actorId: auth.userId,
        refTable: 'tasks',
        refId: task.id,
        data: {
          action: input.status === 'done' ? 'completed' : 'reopened',
          title: input.title ?? task.title,
          taskType: input.type ?? task.type,
        },
        occurredAt: now,
      },
    ]);
  }

  private async loadTask(tx: Tx, id: string): Promise<Task> {
    const record = await this.repository.findTask(tx, id);
    if (!record) throw crmNotFound();
    return toTask(record);
  }

  private audit(
    tx: Tx,
    auth: CrmAuth,
    meta: RequestMeta,
    action: string,
    entity: string,
    entityId: string,
    after: Record<string, unknown>,
  ) {
    return recordAudit(tx, {
      tenantId: auth.tenantId,
      actorType: 'user',
      actorId: auth.userId,
      action,
      entity,
      entityId,
      after,
      ip: meta.ip,
    });
  }
}
