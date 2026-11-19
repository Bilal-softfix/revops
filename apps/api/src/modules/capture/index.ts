import { Module } from '@nestjs/common';
import { CrmModule } from '../crm';
import { IdentityModule } from '../identity';
import { TenancyModule } from '../tenancy';
import { CaptureRepository } from './capture.repository';
import { ImportsController } from './imports.controller';
import { ImportsRepository } from './imports.repository';
import { CsvImportJob, ImportsService } from './imports.service';
import { PublicFormsController } from './public-forms.controller';
import { PublicFormsService } from './public-forms.service';
import { WebhookDeliveriesController } from './webhook-deliveries.controller';
import { WebhooksController } from './webhooks.controller';
import {
  RejectedWebhooksReader,
  WebhookProcessJob,
  WebhookPurgeJob,
  WebhooksService,
} from './webhooks.service';

/**
 * Lead capture channels (M2): public web forms + embed snippet (T2); signed webhooks (T3); CSV import
 * (T5). Every channel hands off to the CRM's LeadIntakeService.
 */
@Module({
  imports: [CrmModule, IdentityModule, TenancyModule],
  controllers: [
    PublicFormsController,
    WebhooksController,
    WebhookDeliveriesController,
    ImportsController,
  ],
  providers: [
    CaptureRepository,
    ImportsRepository,
    ImportsService,
    CsvImportJob,
    PublicFormsService,
    WebhooksService,
    RejectedWebhooksReader,
    WebhookProcessJob,
    WebhookPurgeJob,
  ],
})
export class CaptureModule {}

export { sanitizeAttribution, toIntakeInput } from './mapping';
export { MIN_FILL_MS, PUBLIC_FORM_LIMITS } from './public-forms.service';
export { signWebhook, verifyWebhookSignature, verifyWebhookToken } from './webhook-signature';
export {
  REJECTED_WEBHOOKS,
  WEBHOOK_LIMITS,
  WEBHOOK_PROCESS_JOB,
  WEBHOOK_RETENTION_DAYS,
  WebhookProcessJob,
  WebhookPurgeJob,
} from './webhooks.service';
export {
  CSV_BATCH_SIZE,
  CSV_IMPORT_JOB,
  CSV_UPLOAD_LIMIT,
  CsvImportJob,
  decodeCsv,
  readCsvFile,
  rowKey,
} from './imports.service';
