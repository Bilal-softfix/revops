import { Injectable } from '@nestjs/common';
import type { Tx } from '@revops/db';
import {
  type CreateCustomFieldRequest,
  type CustomFieldDef,
  type CustomFieldDefList,
  type CustomFieldEntity,
  type CustomFieldValues,
  type CustomFieldValuesInput,
  type UpdateCustomFieldRequest,
  buildCustomFieldsSchema,
  customFieldsForPipeline,
} from '@revops/shared';
import { Clock } from '../../platform/clock';
import { DomainError } from '../../platform/errors/domain-error';
import { recordAudit } from '../../platform/outbox/record';
import type { RequestMeta } from '../../platform/request-meta';
import { type CrmAuth, CrmService } from './crm.service';
import { CustomFieldsRepository, toCustomFieldDef } from './custom-fields.repository';
import { crmNotFound } from './errors';

const invalid = (errors: { path: string; message: string }[]) =>
  new DomainError('validation_failed', 400, 'Invalid request', { extensions: { errors } });

@Injectable()
export class CustomFieldsService {
  constructor(
    private readonly crm: CrmService,
    private readonly repository: CustomFieldsRepository,
    private readonly clock: Clock,
  ) {}

  list(auth: CrmAuth, entity?: CustomFieldEntity): Promise<CustomFieldDefList> {
    return this.crm.withCrm(auth, async (tx) => ({
      items: await this.repository.listActive(tx, entity),
    }));
  }

  /** Active definitions of one entity (for validating and showing values). */
  definitions(tx: Tx, entity: CustomFieldEntity): Promise<CustomFieldDef[]> {
    return this.repository.listActive(tx, entity);
  }

  /**
   * Validates `customFields` of a contact/lead write against the active definitions and returns
   * the values to store (null = clear). Errors are field-level: `customFields.<key>`.
   *
   * Leads pass `pipelineId` (M1-T3b): only fields that apply to that pipeline are accepted and
   * required there; a value for a field of another pipeline is rejected as "doesn't apply".
   */
  validateValues(
    defs: CustomFieldDef[],
    input: CustomFieldValuesInput | undefined,
    mode: 'create' | 'patch',
    options: { pipelineId?: string } = {},
  ): CustomFieldValues {
    if (input === undefined && mode === 'patch') return {};
    const applicable =
      options.pipelineId === undefined ? defs : customFieldsForPipeline(defs, options.pipelineId);
    const known = new Set(defs.map((d) => d.key));
    const result = buildCustomFieldsSchema(applicable, mode).safeParse(input ?? {});
    if (result.success) return result.data;
    throw invalid(
      result.error.issues.flatMap((issue) => {
        // Unknown keys come as one issue listing them: report each on its own path.
        const keys =
          issue.code === 'unrecognized_keys' ? issue.keys : [issue.path.map(String).join('.')];
        return keys.map((key) => ({
          path: `customFields.${key}`,
          message:
            issue.code !== 'unrecognized_keys'
              ? issue.message
              : known.has(key)
                ? 'doesn’t apply to this pipeline'
                : 'unknown field',
        }));
      }),
    );
  }

  /** 400 unless every id is an active pipeline of this tenant (another tenant's id = unknown). */
  private async checkPipelines(tx: Tx, ids: readonly string[] | null): Promise<void> {
    if (!ids) return;
    const found = await this.repository.activePipelineIds(tx, ids);
    if (ids.some((id) => !found.has(id))) {
      throw invalid([{ path: 'pipelineIds', message: 'unknown pipeline' }]);
    }
  }

  async create(
    auth: CrmAuth,
    input: CreateCustomFieldRequest,
    meta: RequestMeta,
  ): Promise<CustomFieldDef> {
    return this.crm.withCrm(auth, async (tx) => {
      if (await this.repository.keyTaken(tx, input.entity, input.key)) {
        throw new DomainError(
          'custom_field_exists',
          409,
          'A field with this key exists (or existed) — keys can’t be reused',
        );
      }
      await this.checkPipelines(tx, input.pipelineIds);
      const row = await this.repository.insert(tx, {
        tenantId: auth.tenantId,
        entity: input.entity,
        key: input.key,
        label: input.label,
        type: input.type,
        options: input.options ?? null,
        required: input.required,
        position: await this.repository.nextPosition(tx, input.entity),
      });
      await this.repository.setScope(tx, auth.tenantId, row.id, input.pipelineIds);
      await this.audit(tx, auth, meta, 'custom_field.created', row.id, {
        entity: row.entity,
        key: row.key,
        type: row.type,
        ...(input.pipelineIds ? { pipelineIds: input.pipelineIds } : {}),
      });
      return toCustomFieldDef(row, input.pipelineIds ?? undefined);
    });
  }

  async update(
    auth: CrmAuth,
    id: string,
    input: UpdateCustomFieldRequest,
    meta: RequestMeta,
  ): Promise<CustomFieldDef> {
    return this.crm.withCrm(auth, async (tx) => {
      const current = await this.repository.findActive(tx, id);
      if (!current) throw crmNotFound();
      if (input.options) {
        if (current.type !== 'select' && current.type !== 'multiselect') {
          throw invalid([{ path: 'options', message: 'only select fields have options' }]);
        }
        // Stored values reference option values: relabel or add, never remove.
        const kept = new Set(input.options.map((o) => o.value));
        const removed = (current.options ?? []).filter((o) => !kept.has(o.value));
        if (removed.length > 0) {
          throw invalid([
            {
              path: 'options',
              message: `options can be relabelled or added, not removed (${removed.map((o) => o.value).join(', ')})`,
            },
          ]);
        }
      }
      const { pipelineIds, ...columns } = input;
      if (pipelineIds !== undefined) {
        if (current.entity !== 'lead' && pipelineIds !== null) {
          throw invalid([
            { path: 'pipelineIds', message: 'only lead fields can be limited to pipelines' },
          ]);
        }
        await this.checkPipelines(tx, pipelineIds);
        await this.repository.setScope(tx, auth.tenantId, id, pipelineIds);
      }
      if (Object.keys(columns).length > 0) await this.repository.update(tx, id, columns);
      await this.audit(tx, auth, meta, 'custom_field.updated', id, {
        fields: Object.keys(input).sort(),
        ...(pipelineIds !== undefined ? { pipelineIds } : {}),
      });
      const def = await this.repository.getActive(tx, id);
      if (!def) throw crmNotFound();
      return def;
    });
  }

  /** Soft delete: the field disappears and its stored values are hidden, never destroyed. */
  async remove(auth: CrmAuth, id: string, meta: RequestMeta): Promise<void> {
    await this.crm.withCrm(auth, async (tx) => {
      const current = await this.repository.findActive(tx, id);
      if (!current) throw crmNotFound();
      await this.repository.softDelete(tx, id, this.clock.now());
      await this.audit(tx, auth, meta, 'custom_field.deleted', id, { key: current.key });
    });
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
      entity: 'custom_field',
      entityId,
      after,
      ip: meta.ip,
    });
  }
}
