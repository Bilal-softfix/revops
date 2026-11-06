import { type DynamicModule, Module } from '@nestjs/common';
import type { ApiEnv } from '@revops/shared/env';
import { IdentityModule } from './modules/identity';
import { HealthController } from './platform/health/health.controller';
import { PlatformModule } from './platform/platform.module';
import { EmailModule } from './providers/email';

@Module({})
export class AppModule {
  static register(env: ApiEnv): DynamicModule {
    return {
      module: AppModule,
      imports: [
        PlatformModule.register(env),
        EmailModule.register(env.EMAIL_DRIVER),
        IdentityModule,
      ],
      controllers: [HealthController],
    };
  }
}
