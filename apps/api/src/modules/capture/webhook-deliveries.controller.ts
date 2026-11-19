import { Controller, Get, Param } from '@nestjs/common';
import { type RejectedDeliveryList, rejectedDeliveryListSchema } from '@revops/shared';
import { z } from 'zod';
import { Database } from '../../platform/database/database';
import { DomainError } from '../../platform/errors/domain-error';
import { ZodResponse } from '../../platform/openapi/openapi';
import { ZodBodyPipe } from '../../platform/validation/zod-body.pipe';
import type { CrmAuth } from '../crm';
import { CurrentAuth } from '../identity';
import { RequirePermission } from '../tenancy';
import { CaptureRepository } from './capture.repository';
import { RejectedWebhooksReader } from './webhooks.service';

const idParam = new ZodBodyPipe(z.uuid());

/**
 * Recent rejected webhook deliveries of a source (M2-T3 review): owners/admins only
 * (`source.manage`), so they can debug an integration. Newest 50, from the last 7 days.
 */
@Controller('v1/lead-sources')
export class WebhookDeliveriesController {
  constructor(
    private readonly database: Database,
    private readonly repository: CaptureRepository,
    private readonly reader: RejectedWebhooksReader,
  ) {}

  @Get(':id/rejected-deliveries')
  @ZodResponse(200, rejectedDeliveryListSchema)
  @RequirePermission('source.manage')
  list(
    @CurrentAuth() auth: CrmAuth,
    @Param('id', idParam) id: string,
  ): Promise<RejectedDeliveryList> {
    return this.database.withContext(
      { tenantId: auth.tenantId, userId: auth.userId },
      async (tx) => {
        if (!(await this.repository.sourceForProcessing(tx, id))) {
          throw new DomainError('not_found', 404, 'Not found');
        }
        return this.reader.list(tx, id);
      },
    );
  }
}
