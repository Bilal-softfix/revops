import { Injectable } from '@nestjs/common';
import { JobHandler } from '../../platform/queue/job';
import { INVITATION_EMAIL_JOB, type InvitationEmailJobData } from './job-definitions';
import { TenancyService } from './tenancy.service';

@Injectable()
export class InvitationEmailJobHandler extends JobHandler<InvitationEmailJobData> {
  readonly job = INVITATION_EMAIL_JOB;
  constructor(private readonly tenancy: TenancyService) {
    super();
  }
  handle(data: InvitationEmailJobData): Promise<void> {
    return this.tenancy.sendInvitationEmail(data);
  }
}
