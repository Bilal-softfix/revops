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
   */
  validateValues(
    defs: CustomFieldDef[],
    input: CustomFieldValuesInput | undefined,
    mode: 'create' | 'patch',
  ): CustomFieldValues {
    if (input === undefined && mode === 'patch') return {};
    const result = buildCustomFieldsSchema(defs, mode).safeParse(input ?? {});
    if (result.success) return result.data;
    throw invalid(
      result.error.issues.flatMap((issue) => {
        // Unknown keys come as one issue listing them: report each on its own path.
        const keys =
          issue.code === 'unrecognized_keys' ? issue.keys : [issue.path.map(String).join('.')];
        return keys.map((key) => ({
          path: `customFields.${key}`,
          message: issue.code === 'unrecognized_keys' ? 'unknown field' : issue.message,
        }));
      }),
    );
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
      await this.audit(tx, auth, meta, 'custom_field.created', row.id, {
        entity: row.entity,
        key: row.key,
        type: row.type,
      });
      return toCustomFieldDef(row);
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
      const row = await this.repository.update(tx, id, input);
      await this.audit(tx, auth, meta, 'custom_field.updated', id, {
        fields: Object.keys(input).sort(),
      });
      return toCustomFieldDef(row);
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
