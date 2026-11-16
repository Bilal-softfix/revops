import { z } from 'zod';
import { actorTypeSchema } from '../tenancy/enums.js';

// Notes, tasks and the lead timeline (M1-T5): /v1/leads/:id/{notes,tasks,timeline},
// /v1/notes/:id, /v1/tasks[/:id], /v1/tasks/counts.

export const TASK_TYPES = ['call', 'followup', 'meeting', 'other'] as const;
export const taskTypeSchema = z.enum(TASK_TYPES);
export type TaskType = z.infer<typeof taskTypeSchema>;

export const TASK_STATUSES = ['open', 'done'] as const;
export const taskStatusSchema = z.enum(TASK_STATUSES);
export type TaskStatus = z.infer<typeof taskStatusSchema>;

/** docs/02-data-model.md; call/message/qualification arrive with M3/M4/M5. */
export const TIMELINE_EVENT_TYPES = [
  'created',
  'stage_changed',
  'assignment',
  'note',
  'task',
  'call',
  'message',
  'qualification',
] as const;
export const timelineEventTypeSchema = z.enum(TIMELINE_EVENT_TYPES);
export type TimelineEventType = z.infer<typeof timelineEventTypeSchema>;

/** "My tasks" tabs. Overdue: due before now; today: due later today; upcoming: after today. */
export const TASK_BUCKETS = ['overdue', 'today', 'upcoming'] as const;
export const taskBucketSchema = z.enum(TASK_BUCKETS);
export type TaskBucket = z.infer<typeof taskBucketSchema>;

const userRefSchema = z.object({ id: z.uuid(), name: z.string() });
export type UserRef = z.infer<typeof userRefSchema>;

// ---- notes ----

export const noteBodySchema = z.string().trim().min(1, 'write something').max(10_000);
export const createNoteRequestSchema = z.strictObject({ body: noteBodySchema });
export type CreateNoteRequest = z.infer<typeof createNoteRequestSchema>;
export const updateNoteRequestSchema = createNoteRequestSchema;
export type UpdateNoteRequest = z.infer<typeof updateNoteRequestSchema>;

export const noteSchema = z.object({
  id: z.uuid(),
  leadId: z.uuid(),
  body: z.string(),
  author: userRefSchema.nullable(),
  createdAt: z.iso.datetime(),
  /** Set once the note has been edited. */
  editedAt: z.iso.datetime().nullable(),
});
export type Note = z.infer<typeof noteSchema>;

// ---- tasks ----

const taskTitleSchema = z.string().trim().min(1, 'required').max(200);
const dueAtSchema = z.iso.datetime({ offset: true });

export const createTaskRequestSchema = z.strictObject({
  title: taskTitleSchema,
  type: taskTypeSchema.default('followup'),
  dueAt: dueAtSchema,
  /** Defaults to the caller. Someone else needs `lead.assign`, and must be able to see the lead. */
  assigneeUserId: z.uuid().optional(),
});
export type CreateTaskRequest = z.infer<typeof createTaskRequestSchema>;

export const updateTaskRequestSchema = z
  .strictObject({
    title: taskTitleSchema,
    type: taskTypeSchema,
    dueAt: dueAtSchema,
    assigneeUserId: z.uuid(),
    /** done ↔ open; completing (or reopening) writes a timeline entry. */
    status: taskStatusSchema,
  })
  .partial()
  .refine((body) => Object.keys(body).length > 0, { message: 'nothing to update' });
export type UpdateTaskRequest = z.infer<typeof updateTaskRequestSchema>;

export const taskSchema = z.object({
  id: z.uuid(),
  lead: z.object({ id: z.uuid(), contactName: z.string() }),
  title: z.string(),
  type: taskTypeSchema,
  dueAt: z.iso.datetime(),
  status: taskStatusSchema,
  completedAt: z.iso.datetime().nullable(),
  assignee: userRefSchema.nullable(),
  createdAt: z.iso.datetime(),
});
export type Task = z.infer<typeof taskSchema>;
export const taskListSchema = z.object({ items: z.array(taskSchema) });
export type TaskList = z.infer<typeof taskListSchema>;

export const myTasksQuerySchema = z.object({
  bucket: taskBucketSchema.default('today'),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.uuid().optional(),
});
export type MyTasksQuery = z.infer<typeof myTasksQuerySchema>;
export const taskPageSchema = z.object({
  items: z.array(taskSchema),
  nextCursor: z.uuid().nullable(),
});
export type TaskPage = z.infer<typeof taskPageSchema>;
export const taskCountsSchema = z.object({
  overdue: z.number().int(),
  today: z.number().int(),
  upcoming: z.number().int(),
});
export type TaskCounts = z.infer<typeof taskCountsSchema>;

// ---- timeline ----

const stageRefSchema = z.object({ id: z.uuid(), name: z.string() });
/** Names are snapshots taken when the event happened (stages get renamed or deleted). */
export const timelineDataSchema = z.object({
  pipeline: stageRefSchema.optional(),
  stage: stageRefSchema.optional(),
  fromPipeline: stageRefSchema.optional(),
  fromStage: stageRefSchema.optional(),
  owner: userRefSchema.nullable().optional(),
  fromOwner: userRefSchema.nullable().optional(),
  lostReason: z.string().optional(),
  /** stage_changed because its stage was deleted (M1-T3b decision 4). */
  reason: z.enum(['stage_deleted']).optional(),
  /** task: what happened to it, and its title then. */
  action: z.enum(['completed', 'reopened']).optional(),
  title: z.string().optional(),
  taskType: taskTypeSchema.optional(),
});
export type TimelineData = z.infer<typeof timelineDataSchema>;

export const timelineItemSchema = z.object({
  id: z.uuid(),
  type: timelineEventTypeSchema,
  occurredAt: z.iso.datetime(),
  actor: z.object({ type: actorTypeSchema, user: userRefSchema.nullable() }),
  summary: z.string().nullable(),
  data: timelineDataSchema,
  /** For `note` entries: the note as it is now. */
  note: noteSchema.optional(),
});
export type TimelineItem = z.infer<typeof timelineItemSchema>;

export const timelineQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(30),
  cursor: z.uuid().optional(),
});
export type TimelineQuery = z.infer<typeof timelineQuerySchema>;
export const timelinePageSchema = z.object({
  items: z.array(timelineItemSchema),
  nextCursor: z.uuid().nullable(),
});
export type TimelinePage = z.infer<typeof timelinePageSchema>;

// ---- day bounds ----

/** Offset of `timeZone` from UTC at `at`, in ms (Intl only; no tz database dependency). */
function offsetMs(at: Date, timeZone: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
      .formatToParts(at)
      .map((p) => [p.type, Number(p.value)]),
  ) as Record<string, number>;
  const asUtc = Date.UTC(
    parts.year ?? 0,
    (parts.month ?? 1) - 1,
    parts.day ?? 1,
    parts.hour ?? 0,
    parts.minute ?? 0,
    parts.second ?? 0,
  );
  return asUtc - (at.getTime() - at.getMilliseconds());
}

/** The UTC instants of local midnight today and tomorrow in `timeZone` (for "My tasks"). */
export function dayBounds(
  now: Date,
  timeZone: string,
): { startOfToday: Date; startOfTomorrow: Date } {
  const local = new Date(now.getTime() + offsetMs(now, timeZone));
  const midnight = (dayOffset: number) => {
    const guess = Date.UTC(
      local.getUTCFullYear(),
      local.getUTCMonth(),
      local.getUTCDate() + dayOffset,
    );
    // Re-read the offset at the guess so DST zones land on their real midnight.
    return new Date(
      guess - offsetMs(new Date(guess - offsetMs(new Date(guess), timeZone)), timeZone),
    );
  };
  return { startOfToday: midnight(0), startOfTomorrow: midnight(1) };
}
