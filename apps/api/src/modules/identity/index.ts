import { Module } from '@nestjs/common';
import { IdentityController } from './identity.controller';
import { IdentityRepository } from './identity.repository';
import { IdentityService } from './identity.service';
import { PasswordService } from './password.service';
import { OptionalSessionGuard, SessionGuard } from './session.guard';
import { SessionService } from './session.service';
import { UnverifiedAccountCleanupJob } from './unverified-cleanup.job';

// Public API of the identity module: other modules import only from here.
export { IdentityService } from './identity.service';
export { PasswordService } from './password.service';
export { setSessionCookie } from './session-cookie';
export { CurrentAuth, OptionalAuth, OptionalSessionGuard, SessionGuard } from './session.guard';
export { type AuthContext, SessionService } from './session.service';
export { UnverifiedAccountCleanupJob } from './unverified-cleanup.job';

@Module({
  controllers: [IdentityController],
  providers: [
    IdentityRepository,
    IdentityService,
    PasswordService,
    SessionService,
    SessionGuard,
    OptionalSessionGuard,
    UnverifiedAccountCleanupJob,
  ],
  exports: [
    IdentityService,
    PasswordService,
    SessionService,
    SessionGuard,
    OptionalSessionGuard,
    UnverifiedAccountCleanupJob,
  ],
})
export class IdentityModule {}
