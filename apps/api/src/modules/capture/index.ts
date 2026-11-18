import { Module } from '@nestjs/common';
import { CrmModule } from '../crm';
import { CaptureRepository } from './capture.repository';
import { PublicFormsController } from './public-forms.controller';
import { PublicFormsService } from './public-forms.service';

/**
 * Lead capture channels (M2): public web forms + embed snippet (T2); signed webhooks (T3) and CSV
 * import (T5) join here. Every channel hands off to the CRM's LeadIntakeService.
 */
@Module({
  imports: [CrmModule],
  controllers: [PublicFormsController],
  providers: [CaptureRepository, PublicFormsService],
})
export class CaptureModule {}

export { PUBLIC_FORM_LIMITS, MIN_FILL_MS, sanitizeAttribution } from './public-forms.service';
