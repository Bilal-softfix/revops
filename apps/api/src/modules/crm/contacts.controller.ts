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
  type Contact,
  type ContactPage,
  type ContactQuery,
  type CreateContactRequest,
  type UpdateContactRequest,
  contactPageSchema,
  contactQuerySchema,
  contactSchema,
  createContactRequestSchema,
  updateContactRequestSchema,
} from '@revops/shared';
import type { Request } from 'express';
import { z } from 'zod';
import { ZodResponse } from '../../platform/openapi/openapi';
import { requestMeta } from '../../platform/request-meta';
import { ZodBodyPipe } from '../../platform/validation/zod-body.pipe';
import { CurrentAuth } from '../identity';
import { RequirePermission } from '../tenancy';
import { ContactsService } from './contacts.service';
import type { CrmAuth } from './crm.service';

const idParam = new ZodBodyPipe(z.uuid());

/** Contacts (M1-T1). Which ones a caller sees: ContactsService.scope. */
@Controller('v1/contacts')
export class ContactsController {
  constructor(private readonly contacts: ContactsService) {}

  @Get()
  @ZodResponse(200, contactPageSchema)
  @RequirePermission('lead.read.assigned')
  list(
    @CurrentAuth() auth: CrmAuth,
    @Query(new ZodBodyPipe(contactQuerySchema)) query: ContactQuery,
  ): Promise<ContactPage> {
    return this.contacts.list(auth, query);
  }

  @Get(':id')
  @ZodResponse(200, contactSchema)
  @RequirePermission('lead.read.assigned')
  get(@CurrentAuth() auth: CrmAuth, @Param('id', idParam) id: string): Promise<Contact> {
    return this.contacts.get(auth, id);
  }

  @Post()
  @HttpCode(201)
  @ZodResponse(201, contactSchema, 'Created')
  @RequirePermission('contact.write')
  create(
    @CurrentAuth() auth: CrmAuth,
    @Body(new ZodBodyPipe(createContactRequestSchema)) body: CreateContactRequest,
    @Req() req: Request,
  ): Promise<Contact> {
    return this.contacts.create(auth, body, requestMeta(req));
  }

  @Patch(':id')
  @ZodResponse(200, contactSchema)
  @RequirePermission('contact.write')
  update(
    @CurrentAuth() auth: CrmAuth,
    @Param('id', idParam) id: string,
    @Body(new ZodBodyPipe(updateContactRequestSchema)) body: UpdateContactRequest,
    @Req() req: Request,
  ): Promise<Contact> {
    return this.contacts.update(auth, id, body, requestMeta(req));
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission('contact.delete')
  remove(
    @CurrentAuth() auth: CrmAuth,
    @Param('id', idParam) id: string,
    @Req() req: Request,
  ): Promise<void> {
    return this.contacts.remove(auth, id, requestMeta(req));
  }
}
