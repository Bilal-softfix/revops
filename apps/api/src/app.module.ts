import { type DynamicModule, Module } from '@nestjs/common';
import type { ApiEnv } from '@revops/shared/env';
import { CrmModule } from './modules/crm';
import { IdentityModule } from './modules/identity';
import { TenancyModule } from './modules/tenancy';
import { HealthController } from './platform/health/health.controller';
import { MetricsController } from './platform/metrics/metrics.controller';
import { PlatformModule } from './platform/platform.module';
import { EmailModule } from './providers/email';

@Module({})
export class AppModule {
  static register(env: ApiEnv): DynamicModule {
    return {
      module: AppModule,
      imports: [
        PlatformModule.register(env, 'api'),
        EmailModule.register(env),
        IdentityModule,
        TenancyModule,
        CrmModule,
      ],
      controllers: [HealthController, MetricsController],
    };
  }
}
