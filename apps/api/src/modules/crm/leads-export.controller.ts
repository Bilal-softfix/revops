import { Controller, Get, Header, Query, Req, Res } from '@nestjs/common';
import { ApiProduces, ApiResponse } from '@nestjs/swagger';
import { type LeadExportQuery, leadExportQuerySchema } from '@revops/shared';
import type { Request, Response } from 'express';
import { requestMeta } from '../../platform/request-meta';
import { ZodBodyPipe } from '../../platform/validation/zod-body.pipe';
import { CurrentAuth } from '../identity';
import { RequirePermission } from '../tenancy';
import type { CrmAuth } from './crm.service';
import { LeadsExportService } from './leads-export.service';

/**
 * GET /v1/exports/leads.csv (M1-T6): the leads the caller can see that match the list filters,
 * as a UTF-8 (BOM) CSV with CRLF line ends. More than LEAD_EXPORT_MAX_ROWS → 422
 * `export_too_large` (`limit`, `count`).
 */
@Controller('v1')
export class LeadsExportController {
  constructor(private readonly exports: LeadsExportService) {}

  @Get('exports/leads.csv')
  @RequirePermission('lead.export')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Cache-Control', 'no-store')
  @ApiProduces('text/csv')
  @ApiResponse({
    status: 200,
    description: 'Leads CSV (attachment; leads-YYYY-MM-DD.csv, Asia/Kolkata date)',
    content: { 'text/csv': { schema: { type: 'string' } } },
  })
  async exportLeads(
    @CurrentAuth() auth: CrmAuth,
    @Query(new ZodBodyPipe(leadExportQuerySchema)) query: LeadExportQuery,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<string> {
    const file = await this.exports.exportCsv(auth, query, requestMeta(req));
    res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
    return file.body;
  }
}
