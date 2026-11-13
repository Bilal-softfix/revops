import { Body, Controller, Get, Patch, Req } from '@nestjs/common';
import {
  type CrmSettings,
  type LeadSourceList,
  type PipelineList,
  type UpdateCrmSettingsRequest,
  crmSettingsSchema,
  leadSourceListSchema,
  pipelineListSchema,
  updateCrmSettingsRequestSchema,
} from '@revops/shared';
import type { Request } from 'express';
import { requestMeta } from '../../platform/request-meta';
import { ZodBodyPipe } from '../../platform/validation/zod-body.pipe';
import { ZodResponse } from '../../platform/openapi/openapi';
import { CurrentAuth } from '../identity';
import { RequirePermission } from '../tenancy';
import { type CrmAuth, CrmService } from './crm.service';

/** CRM setup reads (M1-T3a). CRUD for pipelines/stages arrives in M1-T3b, custom fields in T2. */
@Controller('v1')
export class CrmController {
  constructor(private readonly crm: CrmService) {}

  @Get('pipelines')
  @ZodResponse(200, pipelineListSchema)
  @RequirePermission('lead.read.assigned')
  listPipelines(@CurrentAuth() auth: CrmAuth): Promise<PipelineList> {
    return this.crm.listPipelines(auth);
  }

  @Get('crm/settings')
  @ZodResponse(200, crmSettingsSchema)
  @RequirePermission('lead.read.assigned')
  getSettings(@CurrentAuth() auth: CrmAuth): Promise<CrmSettings> {
    return this.crm.getSettings(auth);
  }

  @Patch('crm/settings')
  @ZodResponse(200, crmSettingsSchema)
  @RequirePermission('crm.settings.manage')
  updateSettings(
    @CurrentAuth() auth: CrmAuth,
    @Body(new ZodBodyPipe(updateCrmSettingsRequestSchema)) body: UpdateCrmSettingsRequest,
    @Req() req: Request,
  ): Promise<CrmSettings> {
    return this.crm.updateSettings(auth, body, requestMeta(req));
  }

  @Get('lead-sources')
  @ZodResponse(200, leadSourceListSchema)
  @RequirePermission('lead.read.assigned')
  listLeadSources(@CurrentAuth() auth: CrmAuth): Promise<LeadSourceList> {
    return this.crm.listLeadSources(auth);
  }
}
