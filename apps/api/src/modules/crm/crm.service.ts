import { Injectable, Logger } from '@nestjs/common';
import { type Tx, provisionCrm } from '@revops/db';
import type { CrmSettings, PipelineList, UpdateCrmSettingsRequest } from '@revops/shared';
import { recordAudit } from '../../platform/outbox/record';
import type { RequestMeta } from '../../platform/request-meta';
import { ContactsRepository } from './contacts.repository';
import { Database } from '../../platform/database/database';
import type { AuthContext } from '../identity';
import { CrmRepository } from './crm.repository';

/** Callers come through @RequirePermission, which guarantees an active tenant. */
export type CrmAuth = AuthContext & { tenantId: string };

@Injectable()
export class CrmService {
  private readonly logger = new Logger('Crm');

  constructor(
    private readonly database: Database,
    private readonly repository: CrmRepository,
    private readonly contacts: ContactsRepository,
  ) {}

  async getSettings(auth: CrmAuth): Promise<CrmSettings> {
    return this.database.withContext({ tenantId: auth.tenantId, userId: auth.userId }, (tx) =>
      this.readSettings(tx, auth.tenantId),
    );
  }

  private async readSettings(tx: Tx, tenantId: string): Promise<CrmSettings> {
    return {
      agentContactVisibility: await this.contacts.agentContactVisibility(tx, tenantId),
      allowAgentExport: await this.contacts.allowAgentExport(tx, tenantId),
      dedupePolicy: await this.contacts.dedupePolicy(tx, tenantId),
    };
  }

  /** Owner/admin (crm.settings.manage); audited with before/after of the changed keys only. */
  async updateSettings(
    auth: CrmAuth,
    patch: UpdateCrmSettingsRequest,
    meta: RequestMeta,
  ): Promise<CrmSettings> {
    return this.database.withContext(
      { tenantId: auth.tenantId, userId: auth.userId },
      async (tx) => {
        const before = await this.readSettings(tx, auth.tenantId);
        const after: CrmSettings = { ...before, ...patch };
        const changed: Partial<CrmSettings> = {};
        const was: Partial<CrmSettings> = {};
        if (after.agentContactVisibility !== before.agentContactVisibility) {
          await this.contacts.setAgentContactVisibility(
            tx,
            auth.tenantId,
            after.agentContactVisibility,
          );
          changed.agentContactVisibility = after.agentContactVisibility;
          was.agentContactVisibility = before.agentContactVisibility;
        }
        if (after.allowAgentExport !== before.allowAgentExport) {
          await this.contacts.setAllowAgentExport(tx, auth.tenantId, after.allowAgentExport);
          changed.allowAgentExport = after.allowAgentExport;
          was.allowAgentExport = before.allowAgentExport;
        }
        if (after.dedupePolicy !== before.dedupePolicy) {
          await this.contacts.setDedupePolicy(tx, auth.tenantId, after.dedupePolicy);
          changed.dedupePolicy = after.dedupePolicy;
          was.dedupePolicy = before.dedupePolicy;
        }
        if (Object.keys(changed).length > 0) {
          await recordAudit(tx, {
            tenantId: auth.tenantId,
            actorType: 'user',
            actorId: auth.userId,
            action: 'crm_settings.updated',
            entity: 'tenant',
            entityId: auth.tenantId,
            before: was,
            after: changed,
            ip: meta.ip,
          });
        }
        return after;
      },
    );
  }

  /**
   * Runs `fn` in the tenant's context after making sure the tenant has a CRM setup. New tenants
   * get one at signup; tenants created before M1 (or by the seed) are provisioned here, lazily,
   * from their stored industry template (generic if none). The common path is one cheap EXISTS.
   */
  async withCrm<T>(auth: CrmAuth, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.database.withContext(
      { tenantId: auth.tenantId, userId: auth.userId },
      async (tx) => {
        if (!(await this.repository.hasPipelines(tx))) {
          const template = await this.repository.tenantTemplate(tx, auth.tenantId);
          const result = await provisionCrm(tx, auth.tenantId, template);
          if (result.provisioned) {
            this.logger.log(`provisioned CRM for tenant ${auth.tenantId} from ${result.template}`);
          }
        }
        return fn(tx);
      },
    );
  }

  listPipelines(auth: CrmAuth): Promise<PipelineList> {
    return this.withCrm(auth, async (tx) => ({ items: await this.repository.listPipelines(tx) }));
  }
}
