import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity';
import { PermissionGuard } from './permission.guard';
import { TenancyController } from './tenancy.controller';
import { InvitationEmailJobHandler } from './tenancy.job-handlers';
import { TenancyRepository } from './tenancy.repository';
import { TenancyService } from './tenancy.service';

// Public API of the tenancy module: other modules guard routes with @RequirePermission.
export { PermissionGuard, RequirePermission } from './permission.guard';

@Module({
  imports: [IdentityModule],
  controllers: [TenancyController],
  providers: [TenancyRepository, TenancyService, PermissionGuard, InvitationEmailJobHandler],
  exports: [PermissionGuard],
})
export class TenancyModule {}
