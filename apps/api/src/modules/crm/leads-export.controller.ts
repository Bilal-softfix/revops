import { Controller, Get, Query, Req } from '@nestjs/common';
import { type LeadExportQuery, leadExportQuerySchema } from '@revops/shared';
import type { Request } from 'express';
import { requestMeta } from '../../platform/request-meta';
import { ZodBodyPipe } from '../../platform/validation/zod-body.pipe';
import { CurrentAuth } from '../identity';
import { RequirePermission } from '../tenancy';
import type { CrmAuth } from './crm.service';
import { LeadsExportService } from './leads-export.service';

/** GET /v1/exports/leads.csv (M1-T6). Stub — implemented by the export slice. */
@Controller('v1')
export class LeadsExportController {
  constructor(private readonly exports: LeadsExportService) {}

  @Get('exports/leads.csv')
  @RequirePermission('lead.export')
  exportLeads(
    @CurrentAuth() auth: CrmAuth,
    @Query(new ZodBodyPipe(leadExportQuerySchema)) query: LeadExportQuery,
    @Req() req: Request,
  ): Promise<string> {
    return this.exports.exportCsv(auth, query, requestMeta(req));
  }
}
