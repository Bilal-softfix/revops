import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity';
import { TenancyModule } from '../tenancy';
import { CrmController } from './crm.controller';
import { CrmRepository } from './crm.repository';
import { CrmService } from './crm.service';

// Public API of the CRM module (contacts, leads, pipelines, custom fields — M1).
export { type CrmAuth, CrmService } from './crm.service';

@Module({
  imports: [IdentityModule, TenancyModule],
  controllers: [CrmController],
  providers: [CrmRepository, CrmService],
  exports: [CrmService],
})
export class CrmModule {}
