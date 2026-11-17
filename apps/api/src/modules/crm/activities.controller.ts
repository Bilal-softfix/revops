import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import {
  type CreateNoteRequest,
  type CreateTaskRequest,
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
  createNoteRequestSchema,
  createTaskRequestSchema,
  myTasksQuerySchema,
  noteSchema,
  taskCountsSchema,
  taskListSchema,
  taskPageSchema,
  taskSchema,
  timelinePageSchema,
  timelineQuerySchema,
  updateNoteRequestSchema,
  updateTaskRequestSchema,
} from '@revops/shared';
import type { Request } from 'express';
import { z } from 'zod';
import { ZodResponse } from '../../platform/openapi/openapi';
import { requestMeta } from '../../platform/request-meta';
import { ZodBodyPipe } from '../../platform/validation/zod-body.pipe';
import { CurrentAuth } from '../identity';
import { RequirePermission } from '../tenancy';
import { ActivitiesService } from './activities.service';
import type { CrmAuth } from './crm.service';

const idParam = new ZodBodyPipe(z.uuid());

/**
 * Notes, tasks, timeline (M1-T5). Visibility follows the lead (service): a lead the caller can't
 * see makes its notes / tasks / timeline 404.
 */
@Controller('v1')
export class ActivitiesController {
  constructor(private readonly activities: ActivitiesService) {}

  @Get('leads/:id/timeline')
  @ZodResponse(200, timelinePageSchema)
  @RequirePermission('lead.read.assigned')
  timeline(
    @CurrentAuth() auth: CrmAuth,
    @Param('id', idParam) id: string,
    @Query(new ZodBodyPipe(timelineQuerySchema)) query: TimelineQuery,
  ): Promise<TimelinePage> {
    return this.activities.timeline(auth, id, query);
  }

  @Post('leads/:id/notes')
  @HttpCode(201)
  @ZodResponse(201, noteSchema, 'Created')
  @RequirePermission('lead.write')
  createNote(
    @CurrentAuth() auth: CrmAuth,
    @Param('id', idParam) id: string,
    @Body(new ZodBodyPipe(createNoteRequestSchema)) body: CreateNoteRequest,
    @Req() req: Request,
  ): Promise<Note> {
    return this.activities.createNote(auth, id, body, requestMeta(req));
  }

  @Patch('notes/:id')
  @ZodResponse(200, noteSchema)
  @RequirePermission('lead.write')
  updateNote(
    @CurrentAuth() auth: CrmAuth,
    @Param('id', idParam) id: string,
    @Body(new ZodBodyPipe(updateNoteRequestSchema)) body: UpdateNoteRequest,
    @Req() req: Request,
  ): Promise<Note> {
    return this.activities.updateNote(auth, id, body, requestMeta(req));
  }

  @Delete('notes/:id')
  @HttpCode(204)
  @RequirePermission('lead.write')
  removeNote(
    @CurrentAuth() auth: CrmAuth,
    @Param('id', idParam) id: string,
    @Req() req: Request,
  ): Promise<void> {
    return this.activities.removeNote(auth, id, requestMeta(req));
  }

  @Get('leads/:id/tasks')
  @ZodResponse(200, taskListSchema)
  @RequirePermission('lead.read.assigned')
  tasksOfLead(@CurrentAuth() auth: CrmAuth, @Param('id', idParam) id: string): Promise<TaskList> {
    return this.activities.tasksOfLead(auth, id);
  }

  @Post('leads/:id/tasks')
  @HttpCode(201)
  @ZodResponse(201, taskSchema, 'Created')
  @RequirePermission('lead.write')
  createTask(
    @CurrentAuth() auth: CrmAuth,
    @Param('id', idParam) id: string,
    @Body(new ZodBodyPipe(createTaskRequestSchema)) body: CreateTaskRequest,
    @Req() req: Request,
  ): Promise<Task> {
    return this.activities.createTask(auth, id, body, requestMeta(req));
  }

  /** "My tasks": open tasks assigned to the caller, one bucket at a time. */
  @Get('tasks')
  @ZodResponse(200, taskPageSchema)
  @RequirePermission('lead.read.assigned')
  myTasks(
    @CurrentAuth() auth: CrmAuth,
    @Query(new ZodBodyPipe(myTasksQuerySchema)) query: MyTasksQuery,
  ): Promise<TaskPage> {
    return this.activities.myTasks(auth, query);
  }

  @Get('tasks/counts')
  @ZodResponse(200, taskCountsSchema)
  @RequirePermission('lead.read.assigned')
  myTaskCounts(@CurrentAuth() auth: CrmAuth): Promise<TaskCounts> {
    return this.activities.myTaskCounts(auth);
  }

  @Patch('tasks/:id')
  @ZodResponse(200, taskSchema)
  @RequirePermission('lead.write')
  updateTask(
    @CurrentAuth() auth: CrmAuth,
    @Param('id', idParam) id: string,
    @Body(new ZodBodyPipe(updateTaskRequestSchema)) body: UpdateTaskRequest,
    @Req() req: Request,
  ): Promise<Task> {
    return this.activities.updateTask(auth, id, body, requestMeta(req));
  }

  @Delete('tasks/:id')
  @HttpCode(204)
  @RequirePermission('lead.write')
  removeTask(
    @CurrentAuth() auth: CrmAuth,
    @Param('id', idParam) id: string,
    @Req() req: Request,
  ): Promise<void> {
    return this.activities.removeTask(auth, id, requestMeta(req));
  }
}
