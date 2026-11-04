import { Module } from '@nestjs/common';
import { HealthController } from './platform/health/health.controller';

@Module({
  controllers: [HealthController],
})
export class AppModule {}
