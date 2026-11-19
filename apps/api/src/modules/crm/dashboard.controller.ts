import { Controller, Get } from '@nestjs/common';
import { type DashboardSummary, dashboardSummarySchema } from '@revops/shared';
import { ZodResponse } from '../../platform/openapi/openapi';
import { CurrentAuth } from '../identity';
import { RequirePermission } from '../tenancy';
import type { CrmAuth } from './crm.service';
import { DashboardService } from './dashboard.service';

/** Dashboard (UI refresh): every role, scoped like the leads list. */
@Controller('v1/dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get('summary')
  @ZodResponse(200, dashboardSummarySchema)
  @RequirePermission('lead.read.assigned')
  summary(@CurrentAuth() auth: CrmAuth): Promise<DashboardSummary> {
    return this.dashboard.summary(auth);
  }
}
