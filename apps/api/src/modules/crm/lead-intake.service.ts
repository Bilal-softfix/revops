import { Injectable } from '@nestjs/common';
import type { Tx } from '@revops/db';
import {
  CONTACT_CREATED,
  type IntakeLeadInput,
  type IntakeOutcome,
  LEAD_CREATED,
  LEAD_REENQUIRED,
  type LeadSourceConfig,
  emailSchema,
  normalizePhone,
} from '@revops/shared';
import { Clock } from '../../platform/clock';
import { DomainError } from '../../platform/errors/domain-error';
import { recordAudit, recordEvent } from '../../platform/outbox/record';
import { ActivitiesRepository } from './activities.repository';
import { ContactsRepository } from './contacts.repository';
import { CustomFieldsService } from './custom-fields.service';
import { LeadIntakeRepository } from './lead-intake.repository';
import { LeadsRepository, type StageRow } from './leads.repository';

/** The source an inbound lead came through (its config decides pipeline, stage and owner). */
export interface IntakeSource {
  id: string;
  name: string;
  config: LeadSourceConfig;
}

export interface IntakeRequest {
  tenantId: string;
  source: IntakeSource | null;
  /** Channel-scoped and stable for the same submission: `webhook:<source>:<external id>`, … */
  idempotencyKey: string;
  input: IntakeLeadInput;
}

export interface IntakeResult {
  outcome: IntakeOutcome;
  leadId: string;
  contactId: string;
  /** Lead custom fields that were dropped (unknown, not for this pipeline, or invalid). */
  droppedFields: string[];
}

/** 422: neither a valid phone nor a valid email — nothing to dedupe on or contact. */
export const intakeUnusable = () =>
  new DomainError('intake_unusable', 422, 'A lead needs a valid phone number or email');

const isContactUnique = (error: unknown) =>
  [error, (error as { cause?: unknown }).cause].some((e) => {
    const pg = e as { code?: unknown; constraint_name?: unknown } | undefined;
    return (
      pg?.code === '23505' &&
      (pg.constraint_name === 'contacts_tenant_phone_unique' ||
        pg.constraint_name === 'contacts_tenant_email_unique')
    );
  });

/**
 * One way in for every inbound lead (M2-T4): idempotency → dedupe on phone (E.164), then email →
 * re-enquiry or new lead (tenant `dedupePolicy`) → timeline, audit and outbox event, all in the
 * caller's tenant transaction. Actor is `system`. Manual UI create does NOT come through here.
 */
@Injectable()
export class LeadIntakeService {
  constructor(
    private readonly repository: LeadIntakeRepository,
    private readonly contacts: ContactsRepository,
    private readonly leads: LeadsRepository,
    private readonly activities: ActivitiesRepository,
    private readonly fields: CustomFieldsService,
    private readonly clock: Clock,
  ) {}

  async ingest(tx: Tx, request: IntakeRequest): Promise<IntakeResult> {
    const { tenantId, source, input } = request;
    const phoneE164 = input.phone ? normalizePhone(input.phone) : null;
    const parsedEmail = input.email ? emailSchema.safeParse(input.email) : undefined;
    const email = parsedEmail?.success ? parsedEmail.data : null;
    if (!phoneE164 && !email) throw intakeUnusable();

    const claim = await this.repository.claim(tx, {
      tenantId,
      sourceId: source?.id ?? null,
      idempotencyKey: request.idempotencyKey,
    });
    if (!claim) {
      const first = await this.repository.byKey(tx, request.idempotencyKey);
      if (!first?.leadId || !first.contactId) throw new Error('ingestion claimed but incomplete');
      return {
        outcome: 'duplicate',
        leadId: first.leadId,
        contactId: first.contactId,
        droppedFields: [],
      };
    }

    const now = this.clock.now();
    // A concurrent intake may insert the same new phone/email first: the unique index makes this
    // savepoint fail once that commits, and the retry then finds (and locks) that contact.
    let resolved: { id: string; existed: boolean };
    try {
      resolved = await tx.transaction((sp) =>
        this.resolveContact(sp, tenantId, input, phoneE164, email),
      );
    } catch (error) {
      if (!isContactUnique(error)) throw error;
      resolved = await tx.transaction((sp) =>
        this.resolveContact(sp, tenantId, input, phoneE164, email),
      );
    }

    if (resolved.existed && (await this.contacts.dedupePolicy(tx, tenantId)) === 'reenquiry') {
      const open = await this.repository.lockLatestOpenLead(tx, resolved.id);
      if (open) {
        await this.reenquiry(tx, request, open, now);
        await this.repository.complete(tx, claim.id, {
          outcome: 'reenquiry',
          leadId: open.id,
          contactId: resolved.id,
        });
        return { outcome: 'reenquiry', leadId: open.id, contactId: resolved.id, droppedFields: [] };
      }
    }

    const created = await this.createLead(tx, request, resolved.id, now);
    await this.repository.complete(tx, claim.id, {
      outcome: 'created',
      leadId: created.leadId,
      contactId: resolved.id,
    });
    return { outcome: 'created', ...created, contactId: resolved.id };
  }

  /** Phone match first, then email; the match is locked so concurrent intakes serialise on it. */
  private async resolveContact(
    tx: Tx,
    tenantId: string,
    input: IntakeLeadInput,
    phoneE164: string | null,
    email: string | null,
  ): Promise<{ id: string; existed: boolean }> {
    const match = await this.contacts.findDuplicate(tx, { phoneE164, email });
    if (match) {
      const locked = await this.contacts.lockLive(tx, match.row.id);
      if (locked) return { id: locked.id, existed: true };
    }
    const name = input.name?.trim() || email || phoneE164 || 'Unknown';
    const row = await this.contacts.insert(tx, {
      tenantId,
      name: name.slice(0, 200),
      phoneE164,
      altPhones: [],
      email,
      city: input.city?.trim() || null,
      consent: {},
      customFields: {},
      createdBy: null,
    });
    await recordAudit(tx, {
      tenantId,
      actorType: 'system',
      actorId: null,
      action: 'contact.created',
      entity: 'contact',
      entityId: row.id,
      after: { via: 'intake' },
      ip: null,
    });
    await recordEvent(tx, CONTACT_CREATED, {
      tenantId,
      aggregateId: row.id,
      payload: { contactId: row.id, tenantId },
    });
    return { id: row.id, existed: false };
  }

  private async reenquiry(
    tx: Tx,
    request: IntakeRequest,
    lead: { id: string; contactId: string },
    now: Date,
  ): Promise<void> {
    const { tenantId, source, input } = request;
    await this.repository.touchLead(tx, lead.id, now);
    await this.activities.insertTimeline(tx, [
      {
        tenantId,
        leadId: lead.id,
        contactId: lead.contactId,
        type: 're_enquiry',
        actorType: 'system',
        actorId: null,
        data: {
          source: source ? { id: source.id, name: source.name } : null,
          attribution: input.attribution ?? {},
          // Field names only: the values may be someone else typing this person's number.
          fields: Object.keys(input.leadFields ?? {}).sort(),
        },
        occurredAt: now,
      },
    ]);
    await recordEvent(tx, LEAD_REENQUIRED, {
      tenantId,
      aggregateId: lead.id,
      payload: {
        tenantId,
        leadId: lead.id,
        contactId: lead.contactId,
        sourceId: source?.id ?? null,
      },
    });
  }

  private async createLead(
    tx: Tx,
    request: IntakeRequest,
    contactId: string,
    now: Date,
  ): Promise<{ leadId: string; droppedFields: string[] }> {
    const { tenantId, source, input } = request;
    const config = source?.config;
    // The configured pipeline if it still exists, else the default (locked: see activePipeline).
    const pipeline =
      (config?.pipelineId
        ? await this.leads.activePipeline(tx, config.pipelineId, { lock: true })
        : undefined) ?? (await this.leads.activePipeline(tx, undefined, { lock: true }));
    if (!pipeline) throw new Error('tenant has no active pipeline');
    const stages = await this.leads.stagesOf(tx, pipeline.id);
    const stage: StageRow | undefined =
      stages.find((s) => s.id === config?.stageId && s.category === 'open') ??
      stages.find((s) => s.category === 'open');
    if (!stage) throw new Error('pipeline has no open stage');

    const ownerUserId = await this.owner(tx, tenantId, config, now);
    const { values, dropped } = await this.leadFields(tx, input.leadFields, pipeline.id);
    const row = await this.leads.insert(tx, {
      tenantId,
      contactId,
      pipelineId: pipeline.id,
      stageId: stage.id,
      status: 'open',
      ownerUserId,
      sourceId: source?.id ?? null,
      valuePaise: null,
      attribution: input.attribution ?? {},
      customFields: values,
      wonAt: null,
      lostAt: null,
      lostReason: null,
      createdBy: null,
    });
    const names = await this.leads.userNames(tx, ownerUserId ? [ownerUserId] : []);
    await this.activities.insertTimeline(tx, [
      {
        tenantId,
        leadId: row.id,
        contactId,
        type: 'created',
        actorType: 'system',
        actorId: null,
        data: {
          pipeline: { id: pipeline.id, name: pipeline.name },
          stage: { id: stage.id, name: stage.name },
          owner: ownerUserId ? { id: ownerUserId, name: names.get(ownerUserId) ?? '' } : null,
          source: source ? { id: source.id, name: source.name } : null,
        },
        occurredAt: now,
      },
    ]);
    await recordAudit(tx, {
      tenantId,
      actorType: 'system',
      actorId: null,
      action: 'lead.created',
      entity: 'lead',
      entityId: row.id,
      after: {
        via: 'intake',
        sourceId: source?.id ?? null,
        pipelineId: pipeline.id,
        stageId: stage.id,
        ownerUserId,
        ...(dropped.length > 0 ? { droppedFields: dropped } : {}),
      },
      ip: null,
    });
    await recordEvent(tx, LEAD_CREATED, {
      tenantId,
      aggregateId: row.id,
      payload: {
        tenantId,
        leadId: row.id,
        contactId,
        pipelineId: pipeline.id,
        stageId: stage.id,
        ownerUserId,
        actorUserId: null,
      },
    });
    return { leadId: row.id, droppedFields: dropped };
  }

  /**
   * Owner on arrival (M2-T6), per the source's assignment: `round_robin` (also when there is no
   * source) → the next active agent, or unassigned if there is none; `user` → that member while
   * active, else unassigned; `unassigned` → nobody.
   */
  private async owner(
    tx: Tx,
    tenantId: string,
    config: LeadSourceConfig | undefined,
    now: Date,
  ): Promise<string | null> {
    const assignment = config?.assignment ?? { strategy: 'round_robin' as const };
    if (assignment.strategy === 'round_robin') {
      return this.repository.nextRoundRobinAgent(tx, tenantId, now);
    }
    if (
      assignment.strategy === 'user' &&
      (await this.leads.isActiveMember(tx, assignment.userId))
    ) {
      return assignment.userId;
    }
    return null;
  }

  /** Valid values are kept; each unknown/inapplicable/invalid field is dropped on its own. */
  private async leadFields(
    tx: Tx,
    input: IntakeLeadInput['leadFields'],
    pipelineId: string,
  ): Promise<{ values: Record<string, unknown>; dropped: string[] }> {
    const entries = Object.entries(input ?? {});
    if (entries.length === 0) return { values: {}, dropped: [] };
    const defs = await this.fields.definitions(tx, 'lead');
    const values: Record<string, unknown> = {};
    const dropped: string[] = [];
    for (const [key, value] of entries) {
      try {
        const valid = this.fields.validateValues(defs, { [key]: value }, 'patch', { pipelineId });
        if (valid[key] !== null && valid[key] !== undefined) values[key] = valid[key];
      } catch {
        dropped.push(key);
      }
    }
    return { values, dropped: dropped.sort() };
  }
}
