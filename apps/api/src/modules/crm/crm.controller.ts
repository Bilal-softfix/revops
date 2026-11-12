import { Controller, Get } from '@nestjs/common';
import {
  type LeadSourceList,
  type PipelineList,
  leadSourceListSchema,
  pipelineListSchema,
} from '@revops/shared';
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

  @Get('lead-sources')
  @ZodResponse(200, leadSourceListSchema)
  @RequirePermission('lead.read.assigned')
  listLeadSources(@CurrentAuth() auth: CrmAuth): Promise<LeadSourceList> {
    return this.crm.listLeadSources(auth);
  }
}
