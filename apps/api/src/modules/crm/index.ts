import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity';
import { TenancyModule } from '../tenancy';
import { ContactsController } from './contacts.controller';
import { ContactsRepository } from './contacts.repository';
import { ContactsService } from './contacts.service';
import { CrmController } from './crm.controller';
import { CrmRepository } from './crm.repository';
import { CrmService } from './crm.service';
import { CustomFieldsController } from './custom-fields.controller';
import { CustomFieldsRepository } from './custom-fields.repository';
import { CustomFieldsService } from './custom-fields.service';

// Public API of the CRM module (contacts, leads, pipelines, custom fields — M1).
export { type CrmAuth, CrmService } from './crm.service';

@Module({
  imports: [IdentityModule, TenancyModule],
  controllers: [CrmController, ContactsController, CustomFieldsController],
  providers: [
    CrmRepository,
    CrmService,
    ContactsRepository,
    ContactsService,
    CustomFieldsRepository,
    CustomFieldsService,
  ],
  exports: [CrmService],
})
export class CrmModule {}
