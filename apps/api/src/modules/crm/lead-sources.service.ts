import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { Tx } from '@revops/db';
import {
  type CreateLeadSourceRequest,
  type LeadSource,
  type LeadSourceConfig,
  type LeadSourceList,
  type LeadSourceWithSecret,
  type UpdateLeadSourceRequest,
  leadSourceConfigSchema,
} from '@revops/shared';
import { randomToken } from '@revops/shared/crypto';
import { Clock } from '../../platform/clock';
import { SecretBox } from '../../platform/crypto/secret-box';
import { DomainError } from '../../platform/errors/domain-error';
import { recordAudit } from '../../platform/outbox/record';
import type { RequestMeta } from '../../platform/request-meta';
import { type CrmAuth, CrmService } from './crm.service';
import { CustomFieldsService } from './custom-fields.service';
import { crmNotFound } from './errors';
import { type LeadSourceRow, LeadSourcesRepository } from './lead-sources.repository';
import { LeadsRepository } from './leads.repository';

const invalid = (errors: { path: string; message: string }[]) =>
  new DomainError('validation_failed', 400, 'Invalid request', { extensions: { errors } });
const nameTaken = () =>
  new DomainError('source_name_taken', 409, 'A lead source with this name already exists');

/** Only `api` sources take signed webhooks (M2-T3), so only they get a secret. */
const takesWebhooks = (type: string) => type === 'api';
const newSecret = () => `whsec_${randomToken(32)}`;
/** Binds the ciphertext to its row: copied to another source, it no longer decrypts. */
export const webhookSecretContext = (tenantId: string, sourceId: string) =>
  `lead_source:${tenantId}:${sourceId}:webhook`;

export function toLeadSource(row: LeadSourceRow): LeadSource {
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    type: row.type,
    isActive: row.isActive,
    publicKey: row.publicKey,
    // Template-provisioned rows store {} — parsing fills the defaults.
    config: leadSourceConfigSchema.parse(row.config),
    hasWebhookSecret: row.webhookSecretEnc !== null,
    createdAt: row.createdAt.toISOString(),
  };
}

const isNameConflict = (error: unknown) =>
  [error, (error as { cause?: unknown }).cause].some((e) => {
    const pg = e as { code?: unknown; constraint_name?: unknown } | undefined;
    return pg?.code === '23505' && pg.constraint_name === 'lead_sources_tenant_name_unique';
  });

/** Lead sources (M2-T1). Reads: every role. Writes: `source.manage` (owner, admin), audited. */
@Injectable()
export class LeadSourcesService {
  constructor(
    private readonly crm: CrmService,
    private readonly repository: LeadSourcesRepository,
    private readonly leads: LeadsRepository,
    private readonly fields: CustomFieldsService,
    private readonly secrets: SecretBox,
    private readonly clock: Clock,
  ) {}

  list(auth: CrmAuth): Promise<LeadSourceList> {
    return this.crm.withCrm(auth, async (tx) => ({
      items: (await this.repository.list(tx)).map(toLeadSource),
    }));
  }

  async create(
    auth: CrmAuth,
    input: CreateLeadSourceRequest,
    meta: RequestMeta,
  ): Promise<LeadSourceWithSecret> {
    return this.mapNameConflict(() =>
      this.crm.withCrm(auth, async (tx) => {
        const config = input.config ?? leadSourceConfigSchema.parse({});
        await this.checkConfig(tx, config);
        if (await this.repository.nameTaken(tx, input.name)) throw nameTaken();
        const id = randomUUID();
        const secret = takesWebhooks(input.type) ? newSecret() : undefined;
        const row = await this.repository.insert(tx, {
          id,
          tenantId: auth.tenantId,
          name: input.name,
          type: input.type,
          publicKey: randomToken(32),
          config,
          webhookSecretEnc: secret
            ? this.secrets.encrypt(secret, webhookSecretContext(auth.tenantId, id))
            : null,
        });
        await this.audit(tx, auth, meta, 'lead_source.created', id, {
          name: row.name,
          type: row.type,
        });
        return { source: toLeadSource(row), ...(secret ? { webhookSecret: secret } : {}) };
      }),
    );
  }

  async update(
    auth: CrmAuth,
    id: string,
    input: UpdateLeadSourceRequest,
    meta: RequestMeta,
  ): Promise<LeadSource> {
    return this.mapNameConflict(() =>
      this.crm.withCrm(auth, async (tx) => {
        const current = await this.repository.lock(tx, id);
        if (!current) throw crmNotFound();
        if (input.config) await this.checkConfig(tx, input.config);
        if (input.name !== undefined && (await this.repository.nameTaken(tx, input.name, id))) {
          throw nameTaken();
        }
        const row = await this.repository.update(tx, id, {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
          ...(input.config ? { config: input.config } : {}),
        });
        // Keys only: config holds customers' origins and field names, not worth duplicating.
        await this.audit(tx, auth, meta, 'lead_source.updated', id, {
          fields: Object.keys(input).sort(),
          ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        });
        return toLeadSource(row);
      }),
    );
  }

  /** Soft delete. Leads keep their source id (and name, via the join) for reporting. */
  async remove(auth: CrmAuth, id: string, meta: RequestMeta): Promise<void> {
    await this.crm.withCrm(auth, async (tx) => {
      const current = await this.repository.lock(tx, id);
      if (!current) throw crmNotFound();
      await this.repository.update(tx, id, { deletedAt: this.clock.now(), isActive: false });
      await this.audit(tx, auth, meta, 'lead_source.deleted', id, { name: current.name });
    });
  }

  /** New public key: old form embeds / webhook URLs stop working immediately. */
  async rotateKey(auth: CrmAuth, id: string, meta: RequestMeta): Promise<LeadSource> {
    return this.crm.withCrm(auth, async (tx) => {
      if (!(await this.repository.lock(tx, id))) throw crmNotFound();
      const row = await this.repository.update(tx, id, { publicKey: randomToken(32) });
      await this.audit(tx, auth, meta, 'lead_source.key_rotated', id, {});
      return toLeadSource(row);
    });
  }

  /** New webhook secret (api sources): returned once; the old one stops verifying at once. */
  async rotateSecret(auth: CrmAuth, id: string, meta: RequestMeta): Promise<LeadSourceWithSecret> {
    return this.crm.withCrm(auth, async (tx) => {
      const current = await this.repository.lock(tx, id);
      if (!current) throw crmNotFound();
      if (!takesWebhooks(current.type)) {
        throw invalid([{ path: 'type', message: 'only API sources have a webhook secret' }]);
      }
      const secret = newSecret();
      const row = await this.repository.update(tx, id, {
        webhookSecretEnc: this.secrets.encrypt(secret, webhookSecretContext(auth.tenantId, id)),
      });
      await this.audit(tx, auth, meta, 'lead_source.secret_rotated', id, {});
      return { source: toLeadSource(row), webhookSecret: secret };
    });
  }

  /** Every reference in the config must exist in this tenant (RLS makes others invisible). */
  private async checkConfig(tx: Tx, config: LeadSourceConfig): Promise<void> {
    const errors: { path: string; message: string }[] = [];
    if (config.stageId && !config.pipelineId) {
      errors.push({ path: 'config.stageId', message: 'choose the pipeline too' });
    }
    if (config.pipelineId) {
      if (!(await this.leads.activePipeline(tx, config.pipelineId))) {
        errors.push({ path: 'config.pipelineId', message: 'unknown pipeline' });
      } else if (config.stageId) {
        const stages = await this.leads.stagesOf(tx, config.pipelineId);
        const stage = stages.find((s) => s.id === config.stageId);
        if (!stage) {
          errors.push({ path: 'config.stageId', message: 'not a stage of this pipeline' });
        } else if (stage.category !== 'open') {
          // Won/lost need won_at / a lost reason, which inbound leads don't carry.
          errors.push({ path: 'config.stageId', message: 'new leads must start in an open stage' });
        }
      }
    }
    if (
      config.assignment.strategy === 'user' &&
      !(await this.leads.isActiveMember(tx, config.assignment.userId))
    ) {
      errors.push({
        path: 'config.assignment.userId',
        message: 'not an active member of this workspace',
      });
    }
    const leadFieldKeys = new Set((await this.fields.definitions(tx, 'lead')).map((d) => d.key));
    const targets = Object.entries(config.fieldMapping);
    for (const [field, target] of targets) {
      if (target.startsWith('lead.') && !leadFieldKeys.has(target.slice(5))) {
        errors.push({ path: `config.fieldMapping.${field}`, message: 'unknown lead field' });
      }
    }
    const builtins = targets.map(([, t]) => t).filter((t) => !t.startsWith('lead.'));
    if (new Set(builtins).size !== builtins.length) {
      errors.push({ path: 'config.fieldMapping', message: 'map each contact field only once' });
    }
    if (errors.length > 0) throw invalid(errors);
  }

  private async mapNameConflict<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      if (isNameConflict(error)) throw nameTaken();
      throw error;
    }
  }

  private audit(
    tx: Tx,
    auth: CrmAuth,
    meta: RequestMeta,
    action: string,
    entityId: string,
    after: Record<string, unknown>,
  ) {
    return recordAudit(tx, {
      tenantId: auth.tenantId,
      actorType: 'user',
      actorId: auth.userId,
      action,
      entity: 'lead_source',
      entityId,
      after,
      ip: meta.ip,
    });
  }
}
