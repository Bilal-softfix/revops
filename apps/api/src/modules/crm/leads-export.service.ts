import { Injectable, NotImplementedException } from '@nestjs/common';
import type { LeadExportQuery } from '@revops/shared';
import type { RequestMeta } from '../../platform/request-meta';
import type { CrmAuth } from './crm.service';

/** CSV export of leads (M1-T6). Stub — implemented by the export slice. */
@Injectable()
export class LeadsExportService {
  // eslint-disable-next-line @typescript-eslint/require-await
  async exportCsv(_auth: CrmAuth, _query: LeadExportQuery, _meta: RequestMeta): Promise<string> {
    throw new NotImplementedException();
  }
}
