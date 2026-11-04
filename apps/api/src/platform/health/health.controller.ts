import { Controller, Get } from '@nestjs/common';

// Liveness only. Readiness (DB/Redis) + terminus arrive in M0-T6.
@Controller('health')
export class HealthController {
  @Get()
  check(): { status: 'ok' } {
    return { status: 'ok' };
  }
}
