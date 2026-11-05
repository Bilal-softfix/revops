import { Module } from '@nestjs/common';
import { IdentityController } from './identity.controller';
import { IdentityRepository } from './identity.repository';
import { IdentityService } from './identity.service';
import { PasswordService } from './password.service';
import { SessionGuard } from './session.guard';
import { SessionService } from './session.service';
import { UnverifiedAccountCleanupJob } from './unverified-cleanup.job';

// Public API of the identity module: other modules import only from here.
export { CurrentAuth, SessionGuard } from './session.guard';
export type { AuthContext } from './session.service';
export { UnverifiedAccountCleanupJob } from './unverified-cleanup.job';

@Module({
  controllers: [IdentityController],
  providers: [
    IdentityRepository,
    IdentityService,
    PasswordService,
    SessionService,
    SessionGuard,
    UnverifiedAccountCleanupJob,
  ],
  exports: [SessionService, SessionGuard, UnverifiedAccountCleanupJob],
})
export class IdentityModule {}
