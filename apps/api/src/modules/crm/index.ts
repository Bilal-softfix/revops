import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity';
import { TenancyModule } from '../tenancy';
import { ActivitiesController } from './activities.controller';
import { ActivitiesRepository } from './activities.repository';
import { ActivitiesService } from './activities.service';
import { ContactsController } from './contacts.controller';
import { ContactsRepository } from './contacts.repository';
import { ContactsService } from './contacts.service';
import { CrmController } from './crm.controller';
import { CrmRepository } from './crm.repository';
import { CrmRateLimits } from './crm-rate-limits';
import { CrmService } from './crm.service';
import { CustomFieldsController } from './custom-fields.controller';
import { CustomFieldsRepository } from './custom-fields.repository';
import { CustomFieldsService } from './custom-fields.service';
import { LeadViewsRepository, LeadViewsService } from './lead-views.service';
import { LeadsExportController } from './leads-export.controller';
import { LeadsExportService } from './leads-export.service';
import { LeadsController } from './leads.controller';
import { LeadsRepository } from './leads.repository';
import { LeadIntakeRepository } from './lead-intake.repository';
import { LeadIntakeService } from './lead-intake.service';
import { LeadSourcesController } from './lead-sources.controller';
import { LeadSourcesRepository } from './lead-sources.repository';
import { LeadSourcesService } from './lead-sources.service';
import { LeadsService } from './leads.service';
import { PipelinesController } from './pipelines.controller';
import { PipelinesRepository } from './pipelines.repository';
import { PipelinesService } from './pipelines.service';

// Public API of the CRM module (contacts, leads, pipelines, custom fields — M1).
export { type CrmAuth, CrmService } from './crm.service';

@Module({
  imports: [IdentityModule, TenancyModule],
  controllers: [
    CrmController,
    PipelinesController,
    ContactsController,
    CustomFieldsController,
    LeadsController,
    LeadSourcesController,
    LeadsExportController,
    ActivitiesController,
  ],
  providers: [
    CrmRateLimits,
    CrmRepository,
    CrmService,
    ContactsRepository,
    ContactsService,
    CustomFieldsRepository,
    CustomFieldsService,
    PipelinesRepository,
    PipelinesService,
    LeadsRepository,
    LeadsService,
    LeadSourcesRepository,
    LeadSourcesService,
    LeadIntakeRepository,
    LeadIntakeService,
    LeadViewsRepository,
    LeadViewsService,
    LeadsExportService,
    ActivitiesRepository,
    ActivitiesService,
  ],
  exports: [CrmService, LeadIntakeService],
})
export class CrmModule {}
export {
  type IntakeRequest,
  type IntakeResult,
  type IntakeSource,
  LeadIntakeService,
  intakeUnusable,
} from './lead-intake.service';
export { webhookSecretContext } from './lead-sources.service';
