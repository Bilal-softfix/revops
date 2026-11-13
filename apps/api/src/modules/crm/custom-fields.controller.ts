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
  type CreateCustomFieldRequest,
  type CustomFieldDef,
  type CustomFieldDefList,
  type CustomFieldQuery,
  type UpdateCustomFieldRequest,
  createCustomFieldRequestSchema,
  customFieldDefListSchema,
  customFieldDefSchema,
  customFieldQuerySchema,
  updateCustomFieldRequestSchema,
} from '@revops/shared';
import type { Request } from 'express';
import { z } from 'zod';
import { ZodResponse } from '../../platform/openapi/openapi';
import { requestMeta } from '../../platform/request-meta';
import { ZodBodyPipe } from '../../platform/validation/zod-body.pipe';
import { CurrentAuth } from '../identity';
import { RequirePermission } from '../tenancy';
import type { CrmAuth } from './crm.service';
import { CustomFieldsService } from './custom-fields.service';

const idParam = new ZodBodyPipe(z.uuid());

/** Custom field definitions (M1-T2). Everyone reads them (forms need them); owners/admins edit. */
@Controller('v1/custom-fields')
export class CustomFieldsController {
  constructor(private readonly fields: CustomFieldsService) {}

  @Get()
  @ZodResponse(200, customFieldDefListSchema)
  @RequirePermission('lead.read.assigned')
  list(
    @CurrentAuth() auth: CrmAuth,
    @Query(new ZodBodyPipe(customFieldQuerySchema)) query: CustomFieldQuery,
  ): Promise<CustomFieldDefList> {
    return this.fields.list(auth, query.entity);
  }

  @Post()
  @HttpCode(201)
  @ZodResponse(201, customFieldDefSchema, 'Created')
  @RequirePermission('customfield.manage')
  create(
    @CurrentAuth() auth: CrmAuth,
    @Body(new ZodBodyPipe(createCustomFieldRequestSchema)) body: CreateCustomFieldRequest,
    @Req() req: Request,
  ): Promise<CustomFieldDef> {
    return this.fields.create(auth, body, requestMeta(req));
  }

  @Patch(':id')
  @ZodResponse(200, customFieldDefSchema)
  @RequirePermission('customfield.manage')
  update(
    @CurrentAuth() auth: CrmAuth,
    @Param('id', idParam) id: string,
    @Body(new ZodBodyPipe(updateCustomFieldRequestSchema)) body: UpdateCustomFieldRequest,
    @Req() req: Request,
  ): Promise<CustomFieldDef> {
    return this.fields.update(auth, id, body, requestMeta(req));
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission('customfield.manage')
  remove(
    @CurrentAuth() auth: CrmAuth,
    @Param('id', idParam) id: string,
    @Req() req: Request,
  ): Promise<void> {
    return this.fields.remove(auth, id, requestMeta(req));
  }
}
