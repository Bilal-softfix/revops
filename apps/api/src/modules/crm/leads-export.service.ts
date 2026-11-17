import { Injectable } from '@nestjs/common';
import type { Tx } from '@revops/db';
import {
  type CustomFieldDef,
  LEAD_EXPORT_MAX_ROWS,
  type LeadExportQuery,
  customFieldsForPipeline,
  hasPermission,
} from '@revops/shared';
import { Clock } from '../../platform/clock';
import { type CsvCell, csvDocument } from '../../platform/csv';
import { DomainError } from '../../platform/errors/domain-error';
import { recordAudit } from '../../platform/outbox/record';
import type { RequestMeta } from '../../platform/request-meta';
import { forbidden } from '../tenancy/errors';
import { ContactsRepository } from './contacts.repository';
import { type CrmAuth, CrmService } from './crm.service';
import { CustomFieldsService } from './custom-fields.service';
import { type LeadRecord, LeadsRepository } from './leads.repository';
import { LeadsService } from './leads.service';

/** Column headers of the leads CSV (custom lead fields follow, by label). */
export const LEAD_EXPORT_HEADERS = {
  id: 'Lead ID',
  contactName: 'Contact name',
  phone: 'Phone (E.164)',
  email: 'Email',
  pipeline: 'Pipeline',
  stage: 'Stage',
  status: 'Status',
  owner: 'Owner',
  source: 'Source',
  value: 'Value (₹)',
  createdAt: 'Created at',
  wonAt: 'Won at',
  lostAt: 'Lost at',
  lostReason: 'Lost reason',
} as const;
const BOOL = { yes: 'Yes', no: 'No' } as const;

/** Exports show times in the tenant timezone (Asia/Kolkata until tenants choose one). */
const EXPORT_TIME_ZONE = 'Asia/Kolkata';
const PAGE_SIZE = 500;

const parts = new Intl.DateTimeFormat('en-CA', {
  timeZone: EXPORT_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});
function zoned(date: Date): Record<string, string> {
  return Object.fromEntries(parts.formatToParts(date).map((p) => [p.type, p.value]));
}
/** `YYYY-MM-DD HH:mm` in the export timezone. */
export function formatExportTime(date: Date | null): string {
  if (!date) return '';
  const p = zoned(date);
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
}
/** `YYYY-MM-DD` in the export timezone (the file name). */
export function exportDate(date: Date): string {
  const p = zoned(date);
  return `${p.year}-${p.month}-${p.day}`;
}

/** Integer paise → decimal rupees (123456 → "1234.56"); bigint maths, never floats. */
export function paiseToRupees(paise: bigint | null): string {
  if (paise === null) return '';
  const sign = paise < 0n ? '-' : '';
  const abs = paise < 0n ? -paise : paise;
  return `${sign}${abs / 100n}.${(abs % 100n).toString().padStart(2, '0')}`;
}

/** A stored custom-field value as CSV text: option labels, multiselect "; ", bool Yes/No. */
export function customFieldText(def: CustomFieldDef, value: unknown): string {
  if (value === null || value === undefined) return '';
  const label = (v: unknown) =>
    def.options?.find((o) => o.value === v)?.label ?? (typeof v === 'string' ? v : String(v));
  switch (def.type) {
    case 'bool':
      return value === true ? BOOL.yes : value === false ? BOOL.no : '';
    case 'multiselect':
      return Array.isArray(value) ? value.map(label).join('; ') : label(value);
    case 'select':
      return label(value);
    default:
      return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
  }
}

export interface LeadExport {
  filename: string;
  body: string;
}

/**
 * CSV export of leads (M1-T6). `lead.export` roles, or agents when the tenant setting
 * `allowAgentExport` is on (else 403 `forbidden`). Same visibility and filters as the list (agents: only their own
 * leads), counted first and refused over `maxRows`; one `lead.exported` audit row with the count
 * and filters only — row contents are never logged or audited.
 */
@Injectable()
export class LeadsExportService {
  /** Row cap; a property so tests can lower it without inserting 10k rows. */
  maxRows = LEAD_EXPORT_MAX_ROWS;

  constructor(
    private readonly crm: CrmService,
    private readonly fields: CustomFieldsService,
    private readonly leads: LeadsService,
    private readonly repository: LeadsRepository,
    private readonly clock: Clock,
    private readonly contacts: ContactsRepository,
  ) {}

  async exportCsv(auth: CrmAuth, query: LeadExportQuery, meta: RequestMeta): Promise<LeadExport> {
    const { filters } = query;
    return this.crm.withCrm(auth, async (tx) => {
      // Owners/admins/managers have `lead.export`; agents only when the tenant allows it, and then
      // only their own leads (the scope below).
      if (
        !hasPermission(auth.role, 'lead.export') &&
        !(await this.contacts.allowAgentExport(tx, auth.tenantId))
      ) {
        throw forbidden();
      }
      const defs = await this.fields.definitions(tx, 'lead');
      // Same custom-field filter validation as the list (400 validation_failed).
      this.leads.checkFilters(filters, defs);
      const scope = this.leads.scope(auth);
      const perStage = await this.repository.countByStage(tx, scope, auth.userId, filters, defs);
      const count = [...perStage.values()].reduce((a, b) => a + b, 0);
      if (count > this.maxRows) {
        throw new DomainError(
          'export_too_large',
          422,
          'Too many leads to export — narrow the filters',
          { extensions: { limit: this.maxRows, count } },
        );
      }
      const names = new Names(tx, this.repository);
      const rows: CsvCell[][] = [
        [...Object.values(LEAD_EXPORT_HEADERS), ...defs.map((d) => d.label)],
      ];
      let cursor: string | undefined;
      for (;;) {
        const page = await this.repository.list(tx, scope, auth.userId, filters, defs, {
          limit: PAGE_SIZE,
          cursor,
        });
        for (const record of page) rows.push(await this.row(record, defs, names));
        if (page.length < PAGE_SIZE) break;
        cursor = page.at(-1)?.lead.id;
      }
      await recordAudit(tx, {
        tenantId: auth.tenantId,
        actorType: 'user',
        actorId: auth.userId,
        action: 'lead.exported',
        entity: 'lead',
        entityId: null,
        after: { count: rows.length - 1, filters },
        ip: meta.ip,
      });
      return {
        filename: `leads-${exportDate(this.clock.now())}.csv`,
        body: csvDocument(rows),
      };
    });
  }

  private async row(
    record: LeadRecord,
    defs: readonly CustomFieldDef[],
    names: Names,
  ): Promise<CsvCell[]> {
    const { lead } = record;
    const applies = new Set(customFieldsForPipeline(defs, lead.pipelineId).map((d) => d.key));
    return [
      lead.id,
      record.contact.name,
      record.contact.phoneE164,
      record.contact.email,
      await names.pipeline(lead.pipelineId),
      await names.stage(lead.pipelineId, lead.stageId),
      lead.status,
      record.owner?.name,
      record.source?.name,
      paiseToRupees(lead.valuePaise),
      formatExportTime(lead.createdAt),
      formatExportTime(lead.wonAt),
      formatExportTime(lead.lostAt),
      lead.lostReason,
      // Values of fields that don't apply to the lead's pipeline stay hidden, as in the API.
      ...defs.map((d) => (applies.has(d.key) ? customFieldText(d, lead.customFields[d.key]) : '')),
    ];
  }
}

/** Pipeline / stage names, looked up once per pipeline during an export. */
class Names {
  private readonly pipelines = new Map<string, string>();
  private readonly stages = new Map<string, Map<string, string>>();

  constructor(
    private readonly tx: Tx,
    private readonly repository: LeadsRepository,
  ) {}

  async pipeline(id: string): Promise<string> {
    let name = this.pipelines.get(id);
    if (name === undefined) {
      name = await this.repository.pipelineName(this.tx, id);
      this.pipelines.set(id, name);
    }
    return name;
  }

  async stage(pipelineId: string, stageId: string): Promise<string> {
    let byId = this.stages.get(pipelineId);
    if (!byId) {
      const rows = await this.repository.stagesOf(this.tx, pipelineId);
      byId = new Map(rows.map((s) => [s.id, s.name]));
      this.stages.set(pipelineId, byId);
    }
    return byId.get(stageId) ?? '';
  }
}
