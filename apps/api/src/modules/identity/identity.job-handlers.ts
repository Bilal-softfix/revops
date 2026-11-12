import { Injectable } from '@nestjs/common';
import { type JobContext, JobHandler } from '../../platform/queue/job';
import { IdentityService } from './identity.service';
import {
  type EmailJobData,
  FORGOT_PASSWORD_JOB,
  RESEND_VERIFICATION_JOB,
  SIGNUP_JOB,
  type SignupJobData,
} from './job-definitions';

@Injectable()
export class SignupJobHandler extends JobHandler<SignupJobData> {
  readonly job = SIGNUP_JOB;
  constructor(private readonly identity: IdentityService) {
    super();
  }
  handle(data: SignupJobData, context: JobContext): Promise<void> {
    return this.identity.completeSignup(data, context.attempt);
  }
}

@Injectable()
export class ResendVerificationJobHandler extends JobHandler<EmailJobData> {
  readonly job = RESEND_VERIFICATION_JOB;
  constructor(private readonly identity: IdentityService) {
    super();
  }
  handle(data: EmailJobData, context: JobContext): Promise<void> {
    return this.identity.sendVerificationEmail(data, context.attempt);
  }
}

@Injectable()
export class ForgotPasswordJobHandler extends JobHandler<EmailJobData> {
  readonly job = FORGOT_PASSWORD_JOB;
  constructor(private readonly identity: IdentityService) {
    super();
  }
  handle(data: EmailJobData, context: JobContext): Promise<void> {
    return this.identity.sendPasswordResetEmail(data, context.attempt);
  }
}
