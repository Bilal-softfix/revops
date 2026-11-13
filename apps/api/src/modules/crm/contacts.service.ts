import { Injectable } from '@nestjs/common';
import type { Tx } from '@revops/db';
import {
  CONTACT_CREATED,
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
import { CrmService } from './crm.service';
import { CustomFieldsService } from './custom-fields.service';
import type { CrmAuth } from './crm.service';
import { type ContactScope, ContactsRepository, toContact } from './contacts.repository';
import { contactExists, crmNotFound } from './errors';

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
      const current = await this.repository.findVisible(tx, await this.scope(tx, auth), id);
      if (!current) throw crmNotFound();
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

  private async conflict(tx: Tx, auth: CrmAuth, row: ContactRow, field: 'phone' | 'email') {
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
