import { Injectable } from '@nestjs/common';
import {
  type SQL,
  type Tx,
  and,
  contacts,
  desc,
  eq,
  isNull,
  leads,
  ne,
  or,
  sql,
  tenants,
  users,
} from '@revops/db';
import {
  type AgentContactVisibility,
  type Contact,
  type Consent,
  agentContactVisibilitySchema,
  industryTemplate,
} from '@revops/shared';

/**
 * Who may see which contacts — built in ONE place and applied to every contact query (M1-T1).
 * `all`: every contact in the tenant. Otherwise (agent + tenant setting `assigned`): contacts the
 * user created, or linked to a (non-deleted) lead they own (M1-T4).
 */
export type ContactScope = { all: true } | { all: false; userId: string };

type ContactRow = typeof contacts.$inferSelect;

/** API shape. `customFields` must already be filtered to active definitions by the caller. */
export function toContact(row: ContactRow, customFields: Record<string, unknown>): Contact {
  return {
    id: row.id,
    name: row.name,
    phoneE164: row.phoneE164,
    altPhones: row.altPhones,
    email: row.email,
    city: row.city,
    consent: row.consent,
    customFields,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** `%`, `_` and `\` in user input are literals in LIKE patterns. */
const likeEscape = (value: string) => value.replace(/[\\%_]/g, (c) => `\\${c}`);

@Injectable()
export class ContactsRepository {
  /** The tenant's setting, else its template's default, else the strictest. */
  async agentContactVisibility(tx: Tx, tenantId: string): Promise<AgentContactVisibility> {
    const [row] = await tx
      .select({ settings: tenants.settings, template: tenants.industryTemplate })
      .from(tenants)
      .where(eq(tenants.id, tenantId));
    const stored = agentContactVisibilitySchema.safeParse(row?.settings.agentContactVisibility);
    if (stored.success) return stored.data;
    return row ? industryTemplate(row.template).settings.agentContactVisibility : 'assigned';
  }

  async setAgentContactVisibility(
    tx: Tx,
    tenantId: string,
    value: AgentContactVisibility,
  ): Promise<void> {
    await this.mergeSettings(tx, tenantId, { agentContactVisibility: value });
  }

  /** Tenant setting `allowAgentExport` (M1-T6 review); anything but a stored `true` is false. */
  async allowAgentExport(tx: Tx, tenantId: string): Promise<boolean> {
    const [row] = await tx
      .select({ settings: tenants.settings })
      .from(tenants)
      .where(eq(tenants.id, tenantId));
    return row?.settings.allowAgentExport === true;
  }

  async setAllowAgentExport(tx: Tx, tenantId: string, value: boolean): Promise<void> {
    await this.mergeSettings(tx, tenantId, { allowAgentExport: value });
  }

  private async mergeSettings(
    tx: Tx,
    tenantId: string,
    patch: Record<string, unknown>,
  ): Promise<void> {
    await tx
      .update(tenants)
      .set({ settings: sql`${tenants.settings} || ${JSON.stringify(patch)}::jsonb` })
      .where(eq(tenants.id, tenantId));
  }

  private visible(scope: ContactScope): SQL | undefined {
    if (scope.all) return undefined;
    return or(
      eq(contacts.createdBy, scope.userId),
      sql`exists (select 1 from leads l where l.contact_id = ${contacts.id}
        and l.owner_user_id = ${scope.userId} and l.deleted_at is null)`,
    );
  }

  async list(
    tx: Tx,
    scope: ContactScope,
    page: { q?: string | undefined; limit: number; cursor?: string | undefined },
  ): Promise<ContactRow[]> {
    const conditions: (SQL | undefined)[] = [isNull(contacts.deletedAt), this.visible(scope)];
    if (page.q) {
      const text = `%${likeEscape(page.q)}%`;
      const digits = page.q.replace(/\D/g, '').replace(/^0+/, '');
      conditions.push(
        or(
          sql`${contacts.name} ilike ${text}`,
          sql`${contacts.email}::text ilike ${text}`,
          digits.length >= 3 ? sql`${contacts.phoneE164} like ${`%${digits}%`}` : undefined,
        ),
      );
    }
    if (page.cursor) {
      conditions.push(
        sql`(${contacts.createdAt}, ${contacts.id}) < (select c.created_at, c.id from contacts c where c.id = ${page.cursor})`,
      );
    }
    return tx
      .select()
      .from(contacts)
      .where(and(...conditions))
      .orderBy(desc(contacts.createdAt), desc(contacts.id))
      .limit(page.limit);
  }

  async findVisible(tx: Tx, scope: ContactScope, id: string): Promise<ContactRow | undefined> {
    const [row] = await tx
      .select()
      .from(contacts)
      .where(and(eq(contacts.id, id), isNull(contacts.deletedAt), this.visible(scope)));
    return row;
  }

  /**
   * The live contact holding this phone or email, regardless of visibility (duplicate checks).
   * Callers decide what of it the actor may learn.
   */
  async findDuplicate(
    tx: Tx,
    match: { phoneE164?: string | null | undefined; email?: string | null | undefined },
    excludeId?: string,
  ): Promise<{ row: ContactRow; field: 'phone' | 'email' } | undefined> {
    for (const field of ['phone', 'email'] as const) {
      const value = field === 'phone' ? match.phoneE164 : match.email;
      if (!value) continue;
      const column = field === 'phone' ? contacts.phoneE164 : contacts.email;
      const [row] = await tx
        .select()
        .from(contacts)
        .where(
          and(
            eq(column, value),
            isNull(contacts.deletedAt),
            excludeId ? ne(contacts.id, excludeId) : undefined,
          ),
        )
        .limit(1);
      if (row) return { row, field };
    }
    return undefined;
  }

  /**
   * Display name of whoever is working this contact, for duplicate conflicts: the owner of its
   * most recently updated open lead (else its latest owned lead), else its creator.
   */
  async workingOwnerName(tx: Tx, contact: ContactRow): Promise<string | null> {
    const [lead] = await tx
      .select({ name: users.name })
      .from(leads)
      .innerJoin(users, eq(users.id, leads.ownerUserId))
      .where(and(eq(leads.contactId, contact.id), isNull(leads.deletedAt)))
      .orderBy(sql`(${leads.status} = 'open') desc`, desc(leads.updatedAt))
      .limit(1);
    if (lead) return lead.name;
    if (!contact.createdBy) return null;
    const [row] = await tx
      .select({ name: users.name })
      .from(users)
      .where(eq(users.id, contact.createdBy));
    return row?.name ?? null;
  }

  async insert(
    tx: Tx,
    values: {
      tenantId: string;
      name: string;
      phoneE164: string | null;
      altPhones: string[];
      email: string | null;
      city: string | null;
      consent: Consent;
      customFields: Record<string, unknown>;
      createdBy: string;
    },
  ): Promise<ContactRow> {
    const [row] = await tx.insert(contacts).values(values).returning();
    if (!row) throw new Error('contact insert returned nothing');
    return row;
  }

  async update(
    tx: Tx,
    id: string,
    patch: Partial<
      Pick<ContactRow, 'name' | 'phoneE164' | 'altPhones' | 'email' | 'city' | 'consent'>
    >,
    customFields: Record<string, unknown> = {},
  ): Promise<ContactRow> {
    // Custom fields: merge in SQL (no lost update); null in the patch removes the key.
    const set = Object.fromEntries(Object.entries(customFields).filter(([, v]) => v !== null));
    const clear = Object.keys(customFields).filter((k) => customFields[k] === null);
    const [row] = await tx
      .update(contacts)
      .set({
        ...patch,
        ...(Object.keys(customFields).length > 0
          ? {
              customFields:
                clear.length > 0
                  ? sql`(${contacts.customFields} || ${JSON.stringify(set)}::jsonb) - array[${sql.join(
                      clear.map((key) => sql`${key}`),
                      sql`, `,
                    )}]::text[]`
                  : sql`${contacts.customFields} || ${JSON.stringify(set)}::jsonb`,
            }
          : {}),
        updatedAt: new Date(),
      })
      .where(eq(contacts.id, id))
      .returning();
    if (!row) throw new Error('contact update returned nothing');
    return row;
  }

  async softDelete(tx: Tx, id: string, now: Date): Promise<void> {
    await tx.update(contacts).set({ deletedAt: now, updatedAt: now }).where(eq(contacts.id, id));
  }
}
