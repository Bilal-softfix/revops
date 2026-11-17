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
  type BulkAssignLeadsRequest,
  type BulkChangeLeadStageRequest,
  type BulkLeadResult,
  type ChangeLeadStageRequest,
  type CreateLeadRequest,
  type CreateLeadViewRequest,
  type Lead,
  type LeadBoard,
  type LeadBoardQuery,
  type LeadPage,
  type LeadQuery,
  type LeadView,
  type LeadViewList,
  type UpdateLeadRequest,
  bulkAssignLeadsRequestSchema,
  bulkChangeLeadStageRequestSchema,
  bulkLeadResultSchema,
  changeLeadStageRequestSchema,
  createLeadRequestSchema,
  createLeadViewRequestSchema,
  leadBoardQuerySchema,
  leadBoardSchema,
  leadPageSchema,
  leadQuerySchema,
  leadSchema,
  leadViewListSchema,
  leadViewSchema,
  updateLeadRequestSchema,
} from '@revops/shared';
import type { Request } from 'express';
import { z } from 'zod';
import { ZodResponse } from '../../platform/openapi/openapi';
import { requestMeta } from '../../platform/request-meta';
import { ZodBodyPipe } from '../../platform/validation/zod-body.pipe';
import { CurrentAuth } from '../identity';
import { RequirePermission } from '../tenancy';
import type { CrmAuth } from './crm.service';
import { LeadViewsService } from './lead-views.service';
import { LeadsService } from './leads.service';

const idParam = new ZodBodyPipe(z.uuid());

/**
 * Leads (M1-T4). Every route is visibility-scoped in the service: agents only ever see (and can
 * only touch) the leads they own; other leads are 404.
 */
@Controller('v1')
export class LeadsController {
  constructor(
    private readonly leads: LeadsService,
    private readonly views: LeadViewsService,
  ) {}

  @Get('leads')
  @ZodResponse(200, leadPageSchema)
  @RequirePermission('lead.read.assigned')
  list(
    @CurrentAuth() auth: CrmAuth,
    @Query(new ZodBodyPipe(leadQuerySchema)) query: LeadQuery,
  ): Promise<LeadPage> {
    return this.leads.list(auth, query);
  }

  @Get('leads/board')
  @ZodResponse(200, leadBoardSchema)
  @RequirePermission('lead.read.assigned')
  board(
    @CurrentAuth() auth: CrmAuth,
    @Query(new ZodBodyPipe(leadBoardQuerySchema)) query: LeadBoardQuery,
  ): Promise<LeadBoard> {
    return this.leads.board(auth, query);
  }

  /**
   * Bulk assign (M1-T6): `lead.bulk` + `lead.assign`. All-or-nothing for the leads found;
   * invisible/deleted ids come back as notFoundIds. Path avoids clashing with leads/:id/stage.
   */
  @Post('leads/bulk-assign')
  @HttpCode(200)
  @ZodResponse(200, bulkLeadResultSchema)
  @RequirePermission('lead.bulk')
  bulkAssign(
    @CurrentAuth() auth: CrmAuth,
    @Body(new ZodBodyPipe(bulkAssignLeadsRequestSchema)) body: BulkAssignLeadsRequest,
    @Req() req: Request,
  ): Promise<BulkLeadResult> {
    return this.leads.bulkAssign(auth, body, requestMeta(req));
  }

  /** Bulk stage move (M1-T6): the single stage-change rules per lead, one transaction. */
  @Post('leads/bulk-stage')
  @HttpCode(200)
  @ZodResponse(200, bulkLeadResultSchema)
  @RequirePermission('lead.bulk')
  bulkChangeStage(
    @CurrentAuth() auth: CrmAuth,
    @Body(new ZodBodyPipe(bulkChangeLeadStageRequestSchema)) body: BulkChangeLeadStageRequest,
    @Req() req: Request,
  ): Promise<BulkLeadResult> {
    return this.leads.bulkChangeStage(auth, body, requestMeta(req));
  }

  @Get('leads/:id')
  @ZodResponse(200, leadSchema)
  @RequirePermission('lead.read.assigned')
  get(@CurrentAuth() auth: CrmAuth, @Param('id', idParam) id: string): Promise<Lead> {
    return this.leads.get(auth, id);
  }

  @Post('leads')
  @HttpCode(201)
  @ZodResponse(201, leadSchema, 'Created')
  @RequirePermission('lead.write')
  create(
    @CurrentAuth() auth: CrmAuth,
    @Body(new ZodBodyPipe(createLeadRequestSchema)) body: CreateLeadRequest,
    @Req() req: Request,
  ): Promise<Lead> {
    return this.leads.create(auth, body, requestMeta(req));
  }

  @Patch('leads/:id')
  @ZodResponse(200, leadSchema)
  @RequirePermission('lead.write')
  update(
    @CurrentAuth() auth: CrmAuth,
    @Param('id', idParam) id: string,
    @Body(new ZodBodyPipe(updateLeadRequestSchema)) body: UpdateLeadRequest,
    @Req() req: Request,
  ): Promise<Lead> {
    return this.leads.update(auth, id, body, requestMeta(req));
  }

  /** Stage change (kanban drag-drop, stage picker, pipeline move). Emits lead.stage_changed.v1. */
  @Post('leads/:id/stage')
  @HttpCode(200)
  @ZodResponse(200, leadSchema)
  @RequirePermission('lead.write')
  changeStage(
    @CurrentAuth() auth: CrmAuth,
    @Param('id', idParam) id: string,
    @Body(new ZodBodyPipe(changeLeadStageRequestSchema)) body: ChangeLeadStageRequest,
    @Req() req: Request,
  ): Promise<Lead> {
    return this.leads.changeStage(auth, id, body, requestMeta(req));
  }

  @Delete('leads/:id')
  @HttpCode(204)
  @RequirePermission('lead.delete')
  remove(
    @CurrentAuth() auth: CrmAuth,
    @Param('id', idParam) id: string,
    @Req() req: Request,
  ): Promise<void> {
    return this.leads.remove(auth, id, requestMeta(req));
  }

  @Get('lead-views')
  @ZodResponse(200, leadViewListSchema)
  @RequirePermission('lead.read.assigned')
  listViews(@CurrentAuth() auth: CrmAuth): Promise<LeadViewList> {
    return this.views.list(auth);
  }

  @Post('lead-views')
  @HttpCode(201)
  @ZodResponse(201, leadViewSchema, 'Created')
  @RequirePermission('lead.read.assigned')
  createView(
    @CurrentAuth() auth: CrmAuth,
    @Body(new ZodBodyPipe(createLeadViewRequestSchema)) body: CreateLeadViewRequest,
  ): Promise<LeadView> {
    return this.views.create(auth, body);
  }

  @Delete('lead-views/:id')
  @HttpCode(204)
  @RequirePermission('lead.read.assigned')
  removeView(@CurrentAuth() auth: CrmAuth, @Param('id', idParam) id: string): Promise<void> {
    return this.views.remove(auth, id);
  }
}
