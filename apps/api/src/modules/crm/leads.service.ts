import { Injectable } from '@nestjs/common';
import type { Tx } from '@revops/db';
import {
  CONTACT_CREATED,
  type ChangeLeadStageRequest,
  type CreateLeadRequest,
  type CustomFieldDef,
  LEAD_ASSIGNED,
  LEAD_CREATED,
  LEAD_STAGE_CHANGED,
  type Lead,
  type LeadBoard,
  type LeadBoardQuery,
  type LeadFilters,
  type LeadPage,
  type LeadQuery,
  type UpdateLeadRequest,
  customFieldsForPipeline,
  hasPermission,
  visibleCustomFields,
} from '@revops/shared';
import { Clock } from '../../platform/clock';
import { DomainError } from '../../platform/errors/domain-error';
import { recordAudit, recordEvent } from '../../platform/outbox/record';
import type { RequestMeta } from '../../platform/request-meta';
import { ContactsRepository } from './contacts.repository';
import { ContactsService } from './contacts.service';
import { type CrmAuth, CrmService } from './crm.service';
import { CustomFieldsService } from './custom-fields.service';
import { ActivitiesRepository, type TimelineEntry } from './activities.repository';
import { crmNotFound } from './errors';
import {
  type LeadRecord,
  type LeadRow,
  type LeadScope,
  LeadsRepository,
  type StageRow,
} from './leads.repository';

const invalid = (errors: { path: string; message: string }[]) =>
  new DomainError('validation_failed', 400, 'Invalid request', { extensions: { errors } });
const forbidden = (title: string) => new DomainError('forbidden', 403, title);

/** Whether `error` (or its cause) is a unique violation on a contacts phone/email index. */
function isContactDuplicate(error: unknown): boolean {
  for (const source of [error, (error as { cause?: unknown }).cause]) {
    const pg = source as { code?: unknown; constraint_name?: unknown } | undefined;
    if (
      pg?.code === '23505' &&
      (pg.constraint_name === 'contacts_tenant_phone_unique' ||
        pg.constraint_name === 'contacts_tenant_email_unique')
    ) {
      return true;
    }
  }
  return false;
}
/** FK violation on the lead's stage: the stage was deleted concurrently. */
function isStageGone(error: unknown): boolean {
  for (const source of [error, (error as { cause?: unknown }).cause]) {
    const pg = source as { code?: unknown; constraint_name?: unknown } | undefined;
    if (pg?.code === '23503' && pg.constraint_name === 'leads_stage_fk') return true;
  }
  return false;
}

/** won/lost bookkeeping for a lead entering a stage of `category`. */
function outcome(category: StageRow['category'], now: Date, lostReason: string | undefined) {
  return {
    status: category,
    wonAt: category === 'won' ? now : null,
    lostAt: category === 'lost' ? now : null,
    lostReason: category === 'lost' ? (lostReason ?? null) : null,
  };
}

/**
 * Leads (M1-T4). Visibility: `lead.read.all` roles see every lead; everyone else only the leads
 * they own — an invisible lead is a 404 everywhere (get, edit, move, delete). Ownership changes
 * need `lead.assign`; agents' new leads are theirs. Stage changes go through `changeStage`, which
 * keeps status / won_at / lost fields in sync and emits `lead.stage_changed.v1` via the outbox.
 */
@Injectable()
export class LeadsService {
  constructor(
    private readonly crm: CrmService,
    private readonly fields: CustomFieldsService,
    private readonly contacts: ContactsService,
    private readonly contactsRepository: ContactsRepository,
    private readonly repository: LeadsRepository,
    private readonly activities: ActivitiesRepository,
    private readonly clock: Clock,
  ) {}

  scope(auth: CrmAuth): LeadScope {
    return hasPermission(auth.role, 'lead.read.all')
      ? { all: true }
      : { all: false, userId: auth.userId };
  }

  private present(record: LeadRecord, defs: readonly CustomFieldDef[]): Lead {
    const { lead } = record;
    return {
      id: lead.id,
      contact: record.contact,
      pipelineId: lead.pipelineId,
      stageId: lead.stageId,
      status: lead.status,
      owner: record.owner,
      source: record.source,
      valuePaise: lead.valuePaise === null ? null : Number(lead.valuePaise),
      currency: lead.currency,
      attribution: lead.attribution,
      customFields: visibleCustomFields(
        lead.customFields,
        customFieldsForPipeline(defs, lead.pipelineId),
      ),
      wonAt: lead.wonAt?.toISOString() ?? null,
      lostAt: lead.lostAt?.toISOString() ?? null,
      lostReason: lead.lostReason,
      createdAt: lead.createdAt.toISOString(),
      updatedAt: lead.updatedAt.toISOString(),
    };
  }

  private async load(tx: Tx, auth: CrmAuth, id: string): Promise<Lead> {
    const record = await this.repository.findVisible(tx, this.scope(auth), id);
    if (!record) throw crmNotFound();
    return this.present(record, await this.fields.definitions(tx, 'lead'));
  }

  /** 400 unless every custom-field filter names an active lead field with a fitting value. */
  private checkFilters(filters: LeadFilters, defs: readonly CustomFieldDef[]): void {
    const errors: { path: string; message: string }[] = [];
    for (const [key, value] of Object.entries(filters.customFields ?? {})) {
      const def = defs.find((d) => d.key === key);
      const path = `cf.${key}`;
      if (!def) {
        errors.push({ path, message: 'unknown field' });
        continue;
      }
      const range = typeof value === 'object' && !Array.isArray(value);
      const ok =
        def.type === 'bool'
          ? typeof value === 'boolean'
          : def.type === 'number'
            ? range && [value.min, value.max].every((v) => v === undefined || typeof v === 'number')
            : def.type === 'date'
              ? range &&
                [value.min, value.max].every((v) => v === undefined || typeof v === 'string')
              : def.type === 'text'
                ? typeof value === 'string'
                : typeof value === 'string' || Array.isArray(value);
      if (!ok) errors.push({ path, message: `not a valid filter for a ${def.type} field` });
    }
    if (errors.length > 0) throw invalid(errors);
  }

  list(auth: CrmAuth, query: LeadQuery): Promise<LeadPage> {
    return this.crm.withCrm(auth, async (tx) => {
      const defs = await this.fields.definitions(tx, 'lead');
      this.checkFilters(query.filters, defs);
      const rows = await this.repository.list(
        tx,
        this.scope(auth),
        auth.userId,
        query.filters,
        defs,
        { limit: query.limit + 1, cursor: query.cursor },
      );
      const page = rows.slice(0, query.limit);
      return {
        items: page.map((r) => this.present(r, defs)),
        nextCursor: rows.length > query.limit ? (page.at(-1)?.lead.id ?? null) : null,
      };
    });
  }

  board(auth: CrmAuth, query: LeadBoardQuery): Promise<LeadBoard> {
    return this.crm.withCrm(auth, async (tx) => {
      const pipelineId = query.filters.pipelineId ?? '';
      if (!(await this.repository.activePipeline(tx, pipelineId))) throw crmNotFound();
      const defs = await this.fields.definitions(tx, 'lead');
      this.checkFilters(query.filters, defs);
      const scope = this.scope(auth);
      const counts = await this.repository.countByStage(
        tx,
        scope,
        auth.userId,
        query.filters,
        defs,
      );
      const columns = [];
      for (const stage of await this.repository.stagesOf(tx, pipelineId)) {
        const rows = await this.repository.list(
          tx,
          scope,
          auth.userId,
          { ...query.filters, stageIds: [stage.id] },
          defs,
          { limit: query.perStage + 1 },
        );
        const page = rows.slice(0, query.perStage);
        columns.push({
          stageId: stage.id,
          count: counts.get(stage.id) ?? 0,
          items: page.map((r) => this.present(r, defs)),
          nextCursor: rows.length > query.perStage ? (page.at(-1)?.lead.id ?? null) : null,
        });
      }
      return { pipelineId, columns };
    });
  }

  get(auth: CrmAuth, id: string): Promise<Lead> {
    return this.crm.withCrm(auth, (tx) => this.load(tx, auth, id));
  }

  async create(auth: CrmAuth, input: CreateLeadRequest, meta: RequestMeta): Promise<Lead> {
    try {
      return await this.createOnce(auth, input, meta);
    } catch (error) {
      // A concurrent create inserted the same phone/email first: retry, which now links to it.
      if (!isContactDuplicate(error)) throw error;
      return this.createOnce(auth, input, meta);
    }
  }

  private createOnce(auth: CrmAuth, input: CreateLeadRequest, meta: RequestMeta): Promise<Lead> {
    return this.crm.withCrm(auth, async (tx) => {
      const pipeline = await this.repository.activePipeline(tx, input.pipelineId);
      if (!pipeline) {
        throw input.pipelineId
          ? invalid([{ path: 'pipelineId', message: 'unknown pipeline' }])
          : crmNotFound();
      }
      const stages = await this.repository.stagesOf(tx, pipeline.id);
      const stage = input.stageId
        ? stages.find((s) => s.id === input.stageId)
        : stages.find((s) => s.category === 'open');
      if (!stage) throw invalid([{ path: 'stageId', message: 'not a stage of this pipeline' }]);
      if (stage.category === 'lost' && !input.lostReason) {
        throw invalid([{ path: 'lostReason', message: 'a lost lead needs a reason' }]);
      }
      const ownerUserId = await this.resolveOwner(tx, auth, input.ownerUserId);
      await this.checkSource(tx, input.sourceId);
      const defs = await this.fields.definitions(tx, 'lead');
      const values = this.fields.validateValues(defs, input.customFields, 'create', {
        pipelineId: pipeline.id,
      });
      const contactId = await this.resolveContact(tx, auth, input, meta);
      const now = this.clock.now();
      const row = await this.repository.insert(tx, {
        tenantId: auth.tenantId,
        contactId,
        pipelineId: pipeline.id,
        stageId: stage.id,
        ownerUserId,
        sourceId: input.sourceId ?? null,
        valuePaise:
          input.valuePaise === undefined || input.valuePaise === null
            ? null
            : BigInt(input.valuePaise),
        attribution: input.attribution ?? {},
        customFields: Object.fromEntries(Object.entries(values).filter(([, v]) => v !== null)),
        createdBy: auth.userId,
        ...outcome(stage.category, now, input.lostReason),
      });
      const names = await this.repository.userNames(tx, ownerUserId ? [ownerUserId] : []);
      await this.timeline(tx, auth, row, 'created', now, {
        pipeline: { id: pipeline.id, name: pipeline.name },
        stage: { id: stage.id, name: stage.name },
        owner: ownerUserId ? { id: ownerUserId, name: names.get(ownerUserId) ?? '' } : null,
      });
      await this.audit(tx, auth, meta, 'lead.created', row.id, {
        fields: Object.keys(input).sort(),
        pipelineId: pipeline.id,
        stageId: stage.id,
        ownerUserId,
      });
      await recordEvent(tx, LEAD_CREATED, {
        tenantId: auth.tenantId,
        aggregateId: row.id,
        payload: {
          tenantId: auth.tenantId,
          leadId: row.id,
          contactId,
          pipelineId: pipeline.id,
          stageId: stage.id,
          ownerUserId,
          actorUserId: auth.userId,
        },
      });
      // Assign-role users (read-all) see leads they give to others; everyone else owns theirs.
      return this.load(tx, auth, row.id);
    });
  }

  async update(
    auth: CrmAuth,
    id: string,
    input: UpdateLeadRequest,
    meta: RequestMeta,
  ): Promise<Lead> {
    return this.crm.withCrm(auth, async (tx) => {
      const current = await this.repository.lockVisible(tx, this.scope(auth), id);
      if (!current) throw crmNotFound();
      const ownerChanged =
        input.ownerUserId !== undefined && input.ownerUserId !== current.ownerUserId;
      if (ownerChanged) {
        if (!hasPermission(auth.role, 'lead.assign')) {
          throw forbidden('You can’t change who owns a lead');
        }
        await this.resolveOwner(tx, auth, input.ownerUserId);
      }
      await this.checkSource(tx, input.sourceId);
      const values = this.fields.validateValues(
        await this.fields.definitions(tx, 'lead'),
        input.customFields,
        'patch',
        { pipelineId: current.pipelineId },
      );
      const { customFields: _cf, valuePaise, ...rest } = input;
      await this.repository.update(
        tx,
        id,
        {
          ...rest,
          ...(valuePaise !== undefined
            ? { valuePaise: valuePaise === null ? null : BigInt(valuePaise) }
            : {}),
        },
        values,
      );
      await this.audit(tx, auth, meta, 'lead.updated', id, {
        fields: Object.keys(input).sort(),
        ...(input.customFields ? { customFields: Object.keys(input.customFields).sort() } : {}),
      });
      if (ownerChanged) await this.recordAssignment(tx, auth, meta, current, input.ownerUserId);
      // An assign-role user can hand a lead away and still see it (read-all).
      return this.load(tx, auth, id);
    });
  }

  /**
   * Moves a lead to another stage, optionally of another pipeline. Values of custom fields that
   * don't apply to the new pipeline stay stored (hidden); its required fields aren't enforced
   * until the lead is next edited (Dev decision, M1-T3b).
   */
  async changeStage(
    auth: CrmAuth,
    id: string,
    input: ChangeLeadStageRequest,
    meta: RequestMeta,
  ): Promise<Lead> {
    try {
      return await this.crm.withCrm(auth, async (tx) => {
        const current = await this.repository.lockVisible(tx, this.scope(auth), id);
        if (!current) throw crmNotFound();
        const pipelineId = input.pipelineId ?? current.pipelineId;
        if (pipelineId !== current.pipelineId) {
          if (!(await this.repository.activePipeline(tx, pipelineId))) {
            throw invalid([{ path: 'pipelineId', message: 'unknown pipeline' }]);
          }
        }
        const stage = (await this.repository.stagesOf(tx, pipelineId)).find(
          (s) => s.id === input.stageId,
        );
        if (!stage) throw invalid([{ path: 'stageId', message: 'not a stage of this pipeline' }]);
        if (stage.id === current.stageId && pipelineId === current.pipelineId) {
          return this.load(tx, auth, id); // no-op: no event
        }
        if (stage.category === 'lost' && !input.lostReason) {
          throw invalid([{ path: 'lostReason', message: 'a lost lead needs a reason' }]);
        }
        const now = this.clock.now();
        const next = outcome(stage.category, now, input.lostReason);
        // Moving within won (or within lost) keeps the original date.
        if (stage.category === 'won' && current.status === 'won') next.wonAt = current.wonAt;
        await this.repository.update(tx, id, { pipelineId, stageId: stage.id, ...next });
        await this.audit(
          tx,
          auth,
          meta,
          'lead.stage_changed',
          id,
          {
            pipelineId,
            stageId: stage.id,
            status: stage.category,
            ...(next.lostReason ? { lostReason: next.lostReason } : {}),
          },
          { pipelineId: current.pipelineId, stageId: current.stageId, status: current.status },
        );
        const fromStages = await this.repository.stagesOf(tx, current.pipelineId);
        await this.timeline(tx, auth, current, 'stage_changed', now, {
          fromStage: {
            id: current.stageId,
            name: fromStages.find((s) => s.id === current.stageId)?.name ?? '',
          },
          stage: { id: stage.id, name: stage.name },
          ...(pipelineId !== current.pipelineId
            ? {
                fromPipeline: {
                  id: current.pipelineId,
                  name: await this.repository.pipelineName(tx, current.pipelineId),
                },
                pipeline: {
                  id: pipelineId,
                  name: await this.repository.pipelineName(tx, pipelineId),
                },
              }
            : {}),
          ...(next.lostReason ? { lostReason: next.lostReason } : {}),
        });
        await recordEvent(tx, LEAD_STAGE_CHANGED, {
          tenantId: auth.tenantId,
          aggregateId: id,
          payload: {
            tenantId: auth.tenantId,
            leadId: id,
            fromPipelineId: current.pipelineId,
            fromStageId: current.stageId,
            toPipelineId: pipelineId,
            toStageId: stage.id,
            toStatus: stage.category,
            actorUserId: auth.userId,
          },
        });
        return this.load(tx, auth, id);
      });
    } catch (error) {
      if (isStageGone(error)) {
        throw new DomainError(
          'stage_gone',
          409,
          'That stage was just deleted — reload and try again',
        );
      }
      throw error;
    }
  }

  async remove(auth: CrmAuth, id: string, meta: RequestMeta): Promise<void> {
    await this.crm.withCrm(auth, async (tx) => {
      const current = await this.repository.lockVisible(tx, this.scope(auth), id);
      if (!current) throw crmNotFound();
      await this.repository.softDelete(tx, id, this.clock.now());
      await this.audit(tx, auth, meta, 'lead.deleted', id, {});
    });
  }

  // ---- helpers ----

  /**
   * The owner a write may set. Omitted on create → the creator. Setting anyone else (or nobody)
   * needs `lead.assign`; the owner must be an active member of this tenant.
   */
  private async resolveOwner(
    tx: Tx,
    auth: CrmAuth,
    requested: string | null | undefined,
  ): Promise<string | null> {
    if (requested === undefined) return auth.userId;
    if (requested !== auth.userId && !hasPermission(auth.role, 'lead.assign')) {
      throw forbidden('You can’t assign leads to someone else');
    }
    if (requested !== null && !(await this.repository.isActiveMember(tx, requested))) {
      throw invalid([{ path: 'ownerUserId', message: 'not an active member of this workspace' }]);
    }
    return requested;
  }

  private async checkSource(tx: Tx, sourceId: string | null | undefined): Promise<void> {
    if (sourceId && !(await this.repository.sourceExists(tx, sourceId))) {
      throw invalid([{ path: 'sourceId', message: 'unknown source' }]);
    }
  }

  /**
   * The lead's contact: an existing one the caller can see, or a new one. A new contact whose
   * phone/email already exists links to that contact (one person, one contact) if the caller can
   * see it. If they can't (agent, `assigned` visibility), it's the same 409 as contact create —
   * who handles it, no contact details — and nothing is created (Dev decision, M1-T4 review).
   */
  private async resolveContact(
    tx: Tx,
    auth: CrmAuth,
    input: CreateLeadRequest,
    meta: RequestMeta,
  ): Promise<string> {
    if (input.contactId) {
      const visible = await this.contactsRepository.findVisible(
        tx,
        await this.contacts.scope(tx, auth),
        input.contactId,
      );
      if (!visible) throw invalid([{ path: 'contactId', message: 'unknown contact' }]);
      return visible.id;
    }
    const contact = input.contact;
    if (!contact) throw invalid([{ path: 'contact', message: 'required' }]);
    const duplicate = await this.contactsRepository.findDuplicate(tx, {
      phoneE164: contact.phone,
      email: contact.email,
    });
    if (duplicate) {
      const scope = await this.contacts.scope(tx, auth);
      if (scope.all || (await this.contactsRepository.findVisible(tx, scope, duplicate.row.id))) {
        return duplicate.row.id;
      }
      throw await this.contacts.conflict(tx, auth, duplicate.row, duplicate.field);
    }
    const row = await this.contactsRepository.insert(tx, {
      tenantId: auth.tenantId,
      name: contact.name,
      phoneE164: contact.phone ?? null,
      altPhones: [],
      email: contact.email ?? null,
      city: null,
      consent: {},
      customFields: {},
      createdBy: auth.userId,
    });
    await recordAudit(tx, {
      tenantId: auth.tenantId,
      actorType: 'user',
      actorId: auth.userId,
      action: 'contact.created',
      entity: 'contact',
      entityId: row.id,
      after: { fields: Object.keys(contact).sort(), via: 'lead' },
      ip: meta.ip,
    });
    await recordEvent(tx, CONTACT_CREATED, {
      tenantId: auth.tenantId,
      aggregateId: row.id,
      payload: { contactId: row.id, tenantId: auth.tenantId },
    });
    return row.id;
  }

  private async recordAssignment(
    tx: Tx,
    auth: CrmAuth,
    meta: RequestMeta,
    current: LeadRow,
    to: string | null | undefined,
  ): Promise<void> {
    const toUserId = to ?? null;
    const names = await this.repository.userNames(
      tx,
      [current.ownerUserId, toUserId].filter((x): x is string => x !== null),
    );
    const userRef = (id: string | null) => (id ? { id, name: names.get(id) ?? '' } : null);
    await this.timeline(tx, auth, current, 'assignment', this.clock.now(), {
      fromOwner: userRef(current.ownerUserId),
      owner: userRef(toUserId),
    });
    await this.audit(
      tx,
      auth,
      meta,
      'lead.assigned',
      current.id,
      { ownerUserId: toUserId },
      { ownerUserId: current.ownerUserId },
    );
    await recordEvent(tx, LEAD_ASSIGNED, {
      tenantId: auth.tenantId,
      aggregateId: current.id,
      payload: {
        tenantId: auth.tenantId,
        leadId: current.id,
        fromUserId: current.ownerUserId,
        toUserId,
        actorUserId: auth.userId,
      },
    });
  }

  /** A timeline entry by the calling user (M1-T5), in the caller's transaction. */
  private timeline(
    tx: Tx,
    auth: CrmAuth,
    lead: { id: string; contactId: string },
    type: TimelineEntry['type'],
    occurredAt: Date,
    data: Record<string, unknown>,
  ): Promise<void> {
    return this.activities.insertTimeline(tx, [
      {
        tenantId: auth.tenantId,
        leadId: lead.id,
        contactId: lead.contactId,
        type,
        actorType: 'user',
        actorId: auth.userId,
        data,
        occurredAt,
      },
    ]);
  }

  private audit(
    tx: Tx,
    auth: CrmAuth,
    meta: RequestMeta,
    action: string,
    entityId: string,
    after: Record<string, unknown>,
    before?: Record<string, unknown>,
  ) {
    return recordAudit(tx, {
      tenantId: auth.tenantId,
      actorType: 'user',
      actorId: auth.userId,
      action,
      entity: 'lead',
      entityId,
      ...(before ? { before } : {}),
      after,
      ip: meta.ip,
    });
  }
}
