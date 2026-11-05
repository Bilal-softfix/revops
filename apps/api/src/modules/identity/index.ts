import { Module } from '@nestjs/common';
import { IdentityController } from './identity.controller';
import { IdentityRepository } from './identity.repository';
import { IdentityService } from './identity.service';
import { PasswordService } from './password.service';
import { SessionGuard } from './session.guard';
import { SessionService } from './session.service';

// Public API of the identity module: other modules import only from here.
export { CurrentAuth, SessionGuard } from './session.guard';
export type { AuthContext } from './session.service';

@Module({
  controllers: [IdentityController],
  providers: [IdentityRepository, IdentityService, PasswordService, SessionService, SessionGuard],
  exports: [SessionService, SessionGuard],
})
export class IdentityModule {}
