// Copy for notes, tasks and the lead timeline (M1-T5).

import type { TaskBucket, TaskType } from '@revops/shared';

export const activityStrings = {
  timeline: {
    title: 'Timeline',
    empty: 'Nothing has happened on this lead yet.',
    loadMore: 'Show older',
    system: 'System',
    ai: 'AI assistant',
    someone: 'Someone',
    created: (pipeline: string, stage: string) => `created the lead in ${pipeline} · ${stage}`,
    stageChanged: (from: string, to: string) => `moved the lead from ${from} to ${to}`,
    pipelineChanged: (fromPipeline: string, from: string, toPipeline: string, to: string) =>
      `moved the lead from ${fromPipeline} · ${from} to ${toPipeline} · ${to}`,
    stageDeleted: (from: string, to: string) =>
      `stage changed to ${to} because ${from} was deleted`,
    lostReason: (reason: string) => `Reason: ${reason}`,
    assigned: (to: string) => `assigned the lead to ${to}`,
    unassigned: 'unassigned the lead',
    reassigned: (from: string, to: string) => `reassigned the lead from ${from} to ${to}`,
    note: 'added a note',
    edited: 'edited',
    taskCompleted: (title: string) => `completed the task “${title}”`,
    taskReopened: (title: string) => `reopened the task “${title}”`,
    other: 'recorded an activity',
  },
  notes: {
    label: 'Add a note',
    placeholder: 'What happened? What did they say?',
    add: 'Add note',
    added: 'Note added',
    edit: 'Edit',
    save: 'Save',
    cancel: 'Cancel',
    delete: 'Delete',
    deleted: 'Note deleted',
    confirmDelete: 'Delete this note?',
  },
  tasks: {
    title: 'Tasks',
    empty: 'No tasks yet.',
    add: 'Add task',
    addTitle: 'New task',
    titleLabel: 'Task',
    titlePlaceholder: 'Call back about the quote',
    type: 'Type',
    due: 'Due',
    assignee: 'Assignee',
    create: 'Create task',
    created: 'Task created',
    deleted: 'Task deleted',
    complete: (title: string) => `Mark “${title}” as done`,
    reopen: (title: string) => `Reopen “${title}”`,
    delete: 'Delete task',
    overdue: 'Overdue',
    done: 'Done',
    dueOn: (when: string) => `Due ${when}`,
    types: {
      call: 'Call',
      followup: 'Follow-up',
      meeting: 'Meeting',
      other: 'Other',
    } satisfies Record<TaskType, string>,
  },
  myTasks: {
    title: 'My tasks',
    description: 'Open tasks assigned to you, by due date.',
    buckets: { overdue: 'Overdue', today: 'Today', upcoming: 'Upcoming' } satisfies Record<
      TaskBucket,
      string
    >,
    empty: {
      overdue: 'Nothing overdue. Nice.',
      today: 'Nothing else due today.',
      upcoming: 'Nothing coming up.',
    } satisfies Record<TaskBucket, string>,
    lead: 'Lead',
    loadMore: 'Load more',
  },
};
