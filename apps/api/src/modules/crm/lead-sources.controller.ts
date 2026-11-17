import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Req } from '@nestjs/common';
import {
  type CreateLeadSourceRequest,
  type LeadSource,
  type LeadSourceList,
  type LeadSourceWithSecret,
  type UpdateLeadSourceRequest,
  createLeadSourceRequestSchema,
  leadSourceListSchema,
  leadSourceSchema,
  leadSourceWithSecretSchema,
  updateLeadSourceRequestSchema,
} from '@revops/shared';
import type { Request } from 'express';
import { z } from 'zod';
import { ZodResponse } from '../../platform/openapi/openapi';
import { requestMeta } from '../../platform/request-meta';
import { ZodBodyPipe } from '../../platform/validation/zod-body.pipe';
import { CurrentAuth } from '../identity';
import { RequirePermission } from '../tenancy';
import type { CrmAuth } from './crm.service';
import { LeadSourcesService } from './lead-sources.service';

const idParam = new ZodBodyPipe(z.uuid());

/** Lead sources (M2-T1). List: every role (lead forms). Writes: `source.manage`. */
@Controller('v1/lead-sources')
export class LeadSourcesController {
  constructor(private readonly sources: LeadSourcesService) {}

  @Get()
  @ZodResponse(200, leadSourceListSchema)
  @RequirePermission('lead.read.assigned')
  list(@CurrentAuth() auth: CrmAuth): Promise<LeadSourceList> {
    return this.sources.list(auth);
  }

  @Post()
  @HttpCode(201)
  @ZodResponse(201, leadSourceWithSecretSchema, 'Created (webhookSecret: api sources, shown once)')
  @RequirePermission('source.manage')
  create(
    @CurrentAuth() auth: CrmAuth,
    @Body(new ZodBodyPipe(createLeadSourceRequestSchema)) body: CreateLeadSourceRequest,
    @Req() req: Request,
  ): Promise<LeadSourceWithSecret> {
    return this.sources.create(auth, body, requestMeta(req));
  }

  @Patch(':id')
  @ZodResponse(200, leadSourceSchema)
  @RequirePermission('source.manage')
  update(
    @CurrentAuth() auth: CrmAuth,
    @Param('id', idParam) id: string,
    @Body(new ZodBodyPipe(updateLeadSourceRequestSchema)) body: UpdateLeadSourceRequest,
    @Req() req: Request,
  ): Promise<LeadSource> {
    return this.sources.update(auth, id, body, requestMeta(req));
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission('source.manage')
  remove(
    @CurrentAuth() auth: CrmAuth,
    @Param('id', idParam) id: string,
    @Req() req: Request,
  ): Promise<void> {
    return this.sources.remove(auth, id, requestMeta(req));
  }

  @Post(':id/rotate-key')
  @HttpCode(200)
  @ZodResponse(200, leadSourceSchema)
  @RequirePermission('source.manage')
  rotateKey(
    @CurrentAuth() auth: CrmAuth,
    @Param('id', idParam) id: string,
    @Req() req: Request,
  ): Promise<LeadSource> {
    return this.sources.rotateKey(auth, id, requestMeta(req));
  }

  @Post(':id/rotate-secret')
  @HttpCode(200)
  @ZodResponse(200, leadSourceWithSecretSchema)
  @RequirePermission('source.manage')
  rotateSecret(
    @CurrentAuth() auth: CrmAuth,
    @Param('id', idParam) id: string,
    @Req() req: Request,
  ): Promise<LeadSourceWithSecret> {
    return this.sources.rotateSecret(auth, id, requestMeta(req));
  }
}
