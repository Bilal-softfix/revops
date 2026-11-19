import { Body, Controller, Get, Header, HttpCode, Param, Post, Req, Res } from '@nestjs/common';
import { ApiBody, ApiConsumes, ApiProduces, ApiResponse } from '@nestjs/swagger';
import {
  CSV_FILE_NAME_HEADER,
  CSV_IMPORT_LIMITS,
  type CsvImport,
  type CsvImportList,
  type CsvImportPreview,
  type StartCsvImportRequest,
  csvImportListSchema,
  csvImportPreviewSchema,
  csvImportSchema,
  startCsvImportRequestSchema,
} from '@revops/shared';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { ZodResponse } from '../../platform/openapi/openapi';
import { requestMeta } from '../../platform/request-meta';
import { readRawBody } from '../../platform/validation/read-body';
import { ZodBodyPipe } from '../../platform/validation/zod-body.pipe';
import type { CrmAuth } from '../crm';
import { CurrentAuth } from '../identity';
import { RequirePermission } from '../tenancy';
import { ImportsService } from './imports.service';

const idParam = new ZodBodyPipe(z.uuid());

/** `attachment` with an ASCII fallback name and the exact UTF-8 name (RFC 6266). */
export function attachment(fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

/**
 * CSV import (M2-T5), owners/admins (`source.manage`). Upload the raw file as `text/csv` to a CSV
 * source (≤10 MB, ≤50k rows; name in `X-File-Name`) → preview + suggested mapping → start with a
 * mapping → poll the import → download the error report.
 */
@Controller('v1')
export class ImportsController {
  constructor(private readonly imports: ImportsService) {}

  @Post('lead-sources/:id/imports')
  @HttpCode(201)
  @ApiConsumes('text/csv')
  @ApiBody({ schema: { type: 'string', format: 'binary' } })
  @ZodResponse(201, csvImportPreviewSchema, 'Uploaded: preview and suggested mapping')
  @RequirePermission('source.manage')
  async upload(
    @CurrentAuth() auth: CrmAuth,
    @Param('id', idParam) sourceId: string,
    @Req() req: Request,
  ): Promise<CsvImportPreview> {
    const body = await readRawBody(req, 'text/csv', CSV_IMPORT_LIMITS.maxBytes);
    return this.imports.upload(
      auth,
      sourceId,
      body,
      req.header(CSV_FILE_NAME_HEADER),
      requestMeta(req),
    );
  }

  @Get('lead-sources/:id/imports')
  @ZodResponse(200, csvImportListSchema)
  @RequirePermission('source.manage')
  list(
    @CurrentAuth() auth: CrmAuth,
    @Param('id', idParam) sourceId: string,
  ): Promise<CsvImportList> {
    return this.imports.list(auth, sourceId);
  }

  @Get('imports/:id')
  @ZodResponse(200, csvImportSchema)
  @RequirePermission('source.manage')
  get(@CurrentAuth() auth: CrmAuth, @Param('id', idParam) id: string): Promise<CsvImport> {
    return this.imports.get(auth, id);
  }

  @Post('imports/:id/start')
  @HttpCode(202)
  @ZodResponse(202, csvImportSchema, 'Queued')
  @RequirePermission('source.manage')
  start(
    @CurrentAuth() auth: CrmAuth,
    @Param('id', idParam) id: string,
    @Body(new ZodBodyPipe(startCsvImportRequestSchema)) body: StartCsvImportRequest,
    @Req() req: Request,
  ): Promise<CsvImport> {
    return this.imports.start(auth, id, body, requestMeta(req));
  }

  @Get('imports/:id/errors.csv')
  @RequirePermission('source.manage')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Cache-Control', 'no-store')
  @ApiProduces('text/csv')
  @ApiResponse({ status: 200, description: 'Rows that were not imported (attachment)' })
  async errors(
    @CurrentAuth() auth: CrmAuth,
    @Param('id', idParam) id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<string> {
    const report = await this.imports.errorReport(auth, id);
    res.setHeader('Content-Disposition', attachment(report.fileName));
    return report.csv;
  }
}
