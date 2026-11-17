import { Injectable } from '@nestjs/common';
import type { Tx } from '@revops/db';
import {
  CONTACT_CREATED,
  CONTACT_MERGED,
  type MergeContactsRequest,
  type MergePick,
  PHONE_OR_EMAIL_MESSAGE,
  type Contact,
  type ContactPage,
  type ContactQuery,
  type CreateContactRequest,
  type UpdateContactRequest,
  hasPermission,
  visibleCustomFields,
} from '@revops/shared';
import { Clock } from '../../platform/clock';
import { DomainError } from '../../platform/errors/domain-error';
import { recordAudit, recordEvent } from '../../platform/outbox/record';
import type { RequestMeta } from '../../platform/request-meta';
import { CrmRateLimits } from './crm-rate-limits';
import { CrmService } from './crm.service';
import { CustomFieldsService } from './custom-fields.service';
import { LeadIntakeRepository } from './lead-intake.repository';
import type { CrmAuth } from './crm.service';
import { type ContactScope, ContactsRepository, toContact } from './contacts.repository';
import { contactExists, contactHasLeads, crmNotFound } from './errors';

type ContactRow = Awaited<ReturnType<ContactsRepository['insert']>>;

/** The unique index a duplicate hit, if `error` is one of ours. */
function duplicateField(error: unknown): 'phone' | 'email' | undefined {
  for (const source of [error, (error as { cause?: unknown }).cause]) {
    const pg = source as { code?: unknown; constraint_name?: unknown } | undefined;
    if (pg?.code !== '23505') continue;
    if (pg.constraint_name === 'contacts_tenant_phone_unique') return 'phone';
    if (pg.constraint_name === 'contacts_tenant_email_unique') return 'email';
  }
  return undefined;
}

@Injectable()
export class ContactsService {
  constructor(
    private readonly crm: CrmService,
    private readonly fields: CustomFieldsService,
    private readonly repository: ContactsRepository,
    private readonly clock: Clock,
    private readonly limits: CrmRateLimits,
    private readonly intake: LeadIntakeRepository,
  ) {}

  /** Tenant transaction with the CRM setup in place (field definitions, settings). */
  private inTenant<T>(auth: CrmAuth, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.crm.withCrm(auth, fn);
  }

  /** Rows → API, with values of deleted custom fields hidden. */
  private async present(tx: Tx, rows: ContactRow[]): Promise<Contact[]> {
    const defs = await this.fields.definitions(tx, 'contact');
    return rows.map((row) => toContact(row, visibleCustomFields(row.customFields, defs)));
  }

  /** Owners/admins/managers: all. Agents: per the tenant's agentContactVisibility setting. */
  async scope(tx: Tx, auth: CrmAuth): Promise<ContactScope> {
    if (hasPermission(auth.role, 'lead.read.all')) return { all: true };
    const setting = await this.repository.agentContactVisibility(tx, auth.tenantId);
    return setting === 'all' ? { all: true } : { all: false, userId: auth.userId };
  }

  async list(auth: CrmAuth, query: ContactQuery): Promise<ContactPage> {
    return this.inTenant(auth, async (tx) => {
      const rows = await this.repository.list(tx, await this.scope(tx, auth), {
        ...query,
        limit: query.limit + 1,
      });
      const page = rows.slice(0, query.limit);
      return {
        items: await this.present(tx, page),
        nextCursor: rows.length > query.limit ? (page.at(-1)?.id ?? null) : null,
      };
    });
  }

  async get(auth: CrmAuth, id: string): Promise<Contact> {
    return this.inTenant(auth, async (tx) => {
      const row = await this.repository.findVisible(tx, await this.scope(tx, auth), id);
      if (!row) throw crmNotFound();
      const [contact] = await this.present(tx, [row]);
      if (!contact) throw crmNotFound();
      return contact;
    });
  }

  async create(auth: CrmAuth, input: CreateContactRequest, meta: RequestMeta): Promise<Contact> {
    await this.limits.consume(auth, 'create');
    const email = input.email ?? null;
    const phoneE164 = input.phone ?? null;
    return this.mapDuplicate(auth, { phoneE164, email }, undefined, () =>
      this.inTenant(auth, async (tx) => {
        const values = this.fields.validateValues(
          await this.fields.definitions(tx, 'contact'),
          input.customFields,
          'create',
        );
        await this.assertUnique(tx, auth, { phoneE164, email });
        const row = await this.repository.insert(tx, {
          tenantId: auth.tenantId,
          name: input.name,
          phoneE164: input.phone ?? null,
          altPhones: input.altPhones ?? [],
          email,
          city: input.city ?? null,
          consent: input.consent ?? {},
          customFields: Object.fromEntries(Object.entries(values).filter(([, v]) => v !== null)),
          createdBy: auth.userId,
        });
        await recordAudit(tx, {
          tenantId: auth.tenantId,
          actorType: 'user',
          actorId: auth.userId,
          action: 'contact.created',
          entity: 'contact',
          entityId: row.id,
          // Field names only: audit rows are not a second copy of the contact's PII.
          after: { fields: Object.keys(input).sort() },
          ip: meta.ip,
        });
        await recordEvent(tx, CONTACT_CREATED, {
          tenantId: auth.tenantId,
          aggregateId: row.id,
          payload: { contactId: row.id, tenantId: auth.tenantId },
        });
        const [contact] = await this.present(tx, [row]);
        if (!contact) throw crmNotFound();
        return contact;
      }),
    );
  }

  async update(
    auth: CrmAuth,
    id: string,
    input: UpdateContactRequest,
    meta: RequestMeta,
  ): Promise<Contact> {
    return this.mapDuplicate(auth, { phoneE164: input.phone, email: input.email }, id, () =>
      this.inTenant(auth, async (tx) => {
        const current = await this.repository.findVisible(tx, await this.scope(tx, auth), id);
        if (!current) throw crmNotFound();
        const nextPhone = input.phone !== undefined ? input.phone : current.phoneE164;
        const nextEmail = input.email !== undefined ? input.email : current.email;
        if (nextPhone === null && nextEmail === null) {
          // Same rule as create: a contact keeps at least one way to reach them.
          throw new DomainError('validation_failed', 400, 'Invalid request', {
            extensions: { errors: [{ path: 'phone', message: PHONE_OR_EMAIL_MESSAGE }] },
          });
        }
        const values = this.fields.validateValues(
          await this.fields.definitions(tx, 'contact'),
          input.customFields,
          'patch',
        );
        await this.assertUnique(tx, auth, { phoneE164: input.phone, email: input.email }, id);
        const { phone, customFields: _customFields, ...rest } = input;
        const row = await this.repository.update(
          tx,
          id,
          { ...rest, ...(phone !== undefined ? { phoneE164: phone } : {}) },
          values,
        );
        await recordAudit(tx, {
          tenantId: auth.tenantId,
          actorType: 'user',
          actorId: auth.userId,
          action: 'contact.updated',
          entity: 'contact',
          entityId: id,
          after: {
            fields: Object.keys(input).sort(),
            ...(input.customFields ? { customFields: Object.keys(input.customFields).sort() } : {}),
          },
          ip: meta.ip,
        });
        const [contact] = await this.present(tx, [row]);
        if (!contact) throw crmNotFound();
        return contact;
      }),
    );
  }

  async remove(auth: CrmAuth, id: string, meta: RequestMeta): Promise<void> {
    await this.inTenant(auth, async (tx) => {
      // FOR UPDATE: a lead create linking this contact holds FOR SHARE on it, so the count below
      // sees that lead (or the create waits and then finds the contact gone).
      const current = await this.repository.findVisible(tx, await this.scope(tx, auth), id, {
        lock: 'update',
      });
      if (!current) throw crmNotFound();
      // Dev decision (M2-T0): no orphaned leads. Full erasure (DPDP) is a dedicated M8 flow.
      const leadCount = await this.repository.liveLeadCount(tx, id);
      if (leadCount > 0) throw contactHasLeads(leadCount);
      await this.repository.softDelete(tx, id, this.clock.now());
      await recordAudit(tx, {
        tenantId: auth.tenantId,
        actorType: 'user',
        actorId: auth.userId,
        action: 'contact.deleted',
        entity: 'contact',
        entityId: id,
        ip: meta.ip,
      });
    });
  }

  /**
   * Manual merge (M2-T4): `otherContactId` is merged INTO `id`. Per field, `pick` says whose value
   * survives (default: this contact's, or the other's where this one is empty). All of the other
   * contact's leads (with their notes and tasks), timeline entries and ingestions move here; it is
   * then soft-deleted, which frees its phone/email; a phone that doesn't survive is kept as an
   * alternate number. Both rows are locked in id order. Audited; emits `contact.merged.v1`.
   */
  async merge(
    auth: CrmAuth,
    id: string,
    input: MergeContactsRequest,
    meta: RequestMeta,
  ): Promise<Contact> {
    const invalidMerge = (path: string, message: string) =>
      new DomainError('validation_failed', 400, 'Invalid request', {
        extensions: { errors: [{ path, message }] },
      });
    if (input.otherContactId === id)
      throw invalidMerge('otherContactId', 'pick a different contact');
    return this.inTenant(auth, async (tx) => {
      const scope = await this.scope(tx, auth);
      for (const contactId of [id, input.otherContactId].sort()) {
        await this.repository.lockLive(tx, contactId);
      }
      const self = await this.repository.findVisible(tx, scope, id);
      if (!self) throw crmNotFound();
      const other = await this.repository.findVisible(tx, scope, input.otherContactId);
      if (!other) throw invalidMerge('otherContactId', 'unknown contact');

      const choose = <T>(pick: MergePick | undefined, mine: T | null, theirs: T | null) =>
        pick === 'other' ? theirs : pick === 'this' ? mine : (mine ?? theirs);
      const phoneE164 = choose(input.pick.phone, self.phoneE164, other.phoneE164);
      const email = choose(input.pick.email, self.email, other.email);
      if (phoneE164 === null && email === null) throw invalidMerge('pick', PHONE_OR_EMAIL_MESSAGE);
      const altPhones = [
        ...new Set(
          [self.phoneE164, other.phoneE164, ...self.altPhones, ...other.altPhones].filter(
            (p): p is string => p !== null && p !== phoneE164,
          ),
        ),
      ].slice(0, 10);
      const customFields: Record<string, unknown> = {};
      for (const key of new Set([
        ...Object.keys(self.customFields),
        ...Object.keys(other.customFields),
      ])) {
        const value = choose<unknown>(
          input.customFields[key],
          self.customFields[key] ?? null,
          other.customFields[key] ?? null,
        );
        if (value !== null && value !== undefined) customFields[key] = value;
      }

      const now = this.clock.now();
      // Free the other contact's phone/email first (the unique indexes skip deleted rows).
      await this.repository.softDelete(tx, other.id, now);
      const movedLeadIds = await this.intake.moveLeads(tx, other.id, id);
      await this.intake.moveHistory(tx, other.id, id);
      const row = await this.repository.update(tx, id, {
        name: choose(input.pick.name, self.name, other.name) ?? self.name,
        phoneE164,
        email,
        city: choose(input.pick.city, self.city, other.city),
        altPhones,
        consent: { ...other.consent, ...self.consent },
        customFields,
      });
      await recordAudit(tx, {
        tenantId: auth.tenantId,
        actorType: 'user',
        actorId: auth.userId,
        action: 'contact.merged',
        entity: 'contact',
        entityId: id,
        // Which side won per field, never the values themselves.
        after: {
          mergedContactId: other.id,
          movedLeads: movedLeadIds.length,
          pick: input.pick,
          customFields: input.customFields,
        },
        ip: meta.ip,
      });
      await recordEvent(tx, CONTACT_MERGED, {
        tenantId: auth.tenantId,
        aggregateId: id,
        payload: {
          tenantId: auth.tenantId,
          contactId: id,
          mergedContactId: other.id,
          movedLeadIds,
          actorUserId: auth.userId,
        },
      });
      const [contact] = await this.present(tx, [row]);
      if (!contact) throw crmNotFound();
      return contact;
    });
  }

  /** Throws `contact_exists` (visibility-aware) if another live contact has this phone/email. */
  private async assertUnique(
    tx: Tx,
    auth: CrmAuth,
    match: { phoneE164?: string | null | undefined; email?: string | null | undefined },
    excludeId?: string,
  ): Promise<void> {
    const duplicate = await this.repository.findDuplicate(tx, match, excludeId);
    if (duplicate) throw await this.conflict(tx, auth, duplicate.row, duplicate.field);
  }

  /**
   * The 409 for a duplicate phone/email: names who is working the contact, and identifies the
   * contact only if the caller may see it (shared by contact create/edit and lead create).
   */
  async conflict(tx: Tx, auth: CrmAuth, row: ContactRow, field: 'phone' | 'email') {
    const visible = Boolean(
      await this.repository.findVisible(tx, await this.scope(tx, auth), row.id),
    );
    return contactExists({
      field,
      ownerName: await this.repository.workingOwnerName(tx, row),
      ...(visible ? { contact: { id: row.id, name: row.name } } : {}),
    });
  }

  /**
   * A concurrent create can pass assertUnique and still hit the unique index: answer it with the
   * same visibility-aware 409 instead of a 500.
   */
  private async mapDuplicate<T>(
    auth: CrmAuth,
    match: { phoneE164?: string | null | undefined; email?: string | null | undefined },
    excludeId: string | undefined,
    fn: () => Promise<T>,
  ): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      const field = duplicateField(error);
      if (!field) throw error;
      const conflict = await this.inTenant(auth, async (tx) => {
        const duplicate = await this.repository.findDuplicate(tx, match, excludeId);
        return duplicate ? this.conflict(tx, auth, duplicate.row, duplicate.field) : undefined;
      });
      throw conflict ?? error;
    }
  }
}
