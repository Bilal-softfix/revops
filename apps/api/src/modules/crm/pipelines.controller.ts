import {
  Body,
  Controller,
  Delete,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import {
  type CreatePipelineRequest,
  type CreateStageRequest,
  type DeleteStageQuery,
  type Pipeline,
  type PipelineList,
  type ReorderPipelinesRequest,
  type ReorderStagesRequest,
  type UpdatePipelineRequest,
  type UpdateStageRequest,
  createPipelineRequestSchema,
  createStageRequestSchema,
  deleteStageQuerySchema,
  pipelineListSchema,
  pipelineSchema,
  reorderPipelinesRequestSchema,
  reorderStagesRequestSchema,
  updatePipelineRequestSchema,
  updateStageRequestSchema,
} from '@revops/shared';
import type { Request } from 'express';
import { z } from 'zod';
import { ZodResponse } from '../../platform/openapi/openapi';
import { requestMeta } from '../../platform/request-meta';
import { ZodBodyPipe } from '../../platform/validation/zod-body.pipe';
import { CurrentAuth } from '../identity';
import { RequirePermission } from '../tenancy';
import type { CrmAuth } from './crm.service';
import { PipelinesService } from './pipelines.service';

const idParam = new ZodBodyPipe(z.uuid());

/**
 * Pipeline & stage management (M1-T3b), owners/admins only (`pipeline.manage`). Reads stay on
 * `GET /v1/pipelines` (CrmController, every role). Writes return the changed pipeline.
 */
@Controller('v1/pipelines')
@RequirePermission('pipeline.manage')
export class PipelinesController {
  constructor(private readonly pipelines: PipelinesService) {}

  @Post()
  @HttpCode(201)
  @ZodResponse(201, pipelineSchema, 'Created')
  create(
    @CurrentAuth() auth: CrmAuth,
    @Body(new ZodBodyPipe(createPipelineRequestSchema)) body: CreatePipelineRequest,
    @Req() req: Request,
  ): Promise<Pipeline> {
    return this.pipelines.create(auth, body, requestMeta(req));
  }

  @Put('order')
  @ZodResponse(200, pipelineListSchema)
  reorder(
    @CurrentAuth() auth: CrmAuth,
    @Body(new ZodBodyPipe(reorderPipelinesRequestSchema)) body: ReorderPipelinesRequest,
    @Req() req: Request,
  ): Promise<PipelineList> {
    return this.pipelines.reorder(auth, body.pipelineIds, requestMeta(req));
  }

  @Patch(':id')
  @ZodResponse(200, pipelineSchema)
  update(
    @CurrentAuth() auth: CrmAuth,
    @Param('id', idParam) id: string,
    @Body(new ZodBodyPipe(updatePipelineRequestSchema)) body: UpdatePipelineRequest,
    @Req() req: Request,
  ): Promise<Pipeline> {
    return this.pipelines.update(auth, id, body, requestMeta(req));
  }

  @Delete(':id')
  @HttpCode(204)
  remove(
    @CurrentAuth() auth: CrmAuth,
    @Param('id', idParam) id: string,
    @Req() req: Request,
  ): Promise<void> {
    return this.pipelines.remove(auth, id, requestMeta(req));
  }

  @Post(':id/stages')
  @HttpCode(201)
  @ZodResponse(201, pipelineSchema, 'Created')
  addStage(
    @CurrentAuth() auth: CrmAuth,
    @Param('id', idParam) id: string,
    @Body(new ZodBodyPipe(createStageRequestSchema)) body: CreateStageRequest,
    @Req() req: Request,
  ): Promise<Pipeline> {
    return this.pipelines.addStage(auth, id, body, requestMeta(req));
  }

  @Put(':id/stages/order')
  @ZodResponse(200, pipelineSchema)
  reorderStages(
    @CurrentAuth() auth: CrmAuth,
    @Param('id', idParam) id: string,
    @Body(new ZodBodyPipe(reorderStagesRequestSchema)) body: ReorderStagesRequest,
    @Req() req: Request,
  ): Promise<Pipeline> {
    return this.pipelines.reorderStages(auth, id, body.stageIds, requestMeta(req));
  }

  @Patch(':id/stages/:stageId')
  @ZodResponse(200, pipelineSchema)
  updateStage(
    @CurrentAuth() auth: CrmAuth,
    @Param('id', idParam) id: string,
    @Param('stageId', idParam) stageId: string,
    @Body(new ZodBodyPipe(updateStageRequestSchema)) body: UpdateStageRequest,
    @Req() req: Request,
  ): Promise<Pipeline> {
    return this.pipelines.updateStage(auth, id, stageId, body, requestMeta(req));
  }

  /** `?moveTo=<stageId>` moves the stage's leads first (required when it has any). */
  @Delete(':id/stages/:stageId')
  @ZodResponse(200, pipelineSchema)
  deleteStage(
    @CurrentAuth() auth: CrmAuth,
    @Param('id', idParam) id: string,
    @Param('stageId', idParam) stageId: string,
    @Query(new ZodBodyPipe(deleteStageQuerySchema)) query: DeleteStageQuery,
    @Req() req: Request,
  ): Promise<Pipeline> {
    return this.pipelines.deleteStage(auth, id, stageId, query.moveTo, requestMeta(req));
  }
}
