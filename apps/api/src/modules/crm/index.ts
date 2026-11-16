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
import { CrmService } from './crm.service';
import { CustomFieldsController } from './custom-fields.controller';
import { CustomFieldsRepository } from './custom-fields.repository';
import { CustomFieldsService } from './custom-fields.service';
import { LeadViewsRepository, LeadViewsService } from './lead-views.service';
import { LeadsController } from './leads.controller';
import { LeadsRepository } from './leads.repository';
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
    ActivitiesController,
  ],
  providers: [
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
    LeadViewsRepository,
    LeadViewsService,
    ActivitiesRepository,
    ActivitiesService,
  ],
  exports: [CrmService],
})
export class CrmModule {}
