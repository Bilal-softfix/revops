import { Injectable } from '@nestjs/common';
import { type Tx, and, asc, eq, savedViews } from '@revops/db';
import {
  type CreateLeadViewRequest,
  type LeadView,
  type LeadViewList,
  leadFiltersSchema,
} from '@revops/shared';
import { DomainError } from '../../platform/errors/domain-error';
import { type CrmAuth, CrmService } from './crm.service';
import { crmNotFound } from './errors';

type ViewRow = typeof savedViews.$inferSelect;

function toView(row: ViewRow): LeadView {
  // Filters were validated when saved; a view saved under an older schema degrades to "no filters".
  const filters = leadFiltersSchema.safeParse(row.filters);
  return {
    id: row.id,
    name: row.name,
    layout: row.layout === 'board' ? 'board' : 'list',
    filters: filters.success ? filters.data : {},
    createdAt: row.createdAt.toISOString(),
  };
}

/** SQL for saved lead views. Every query is limited to one user's own views. */
@Injectable()
export class LeadViewsRepository {
  private mine(userId: string) {
    return and(eq(savedViews.userId, userId), eq(savedViews.entity, 'lead'));
  }

  list(tx: Tx, userId: string): Promise<ViewRow[]> {
    return tx.select().from(savedViews).where(this.mine(userId)).orderBy(asc(savedViews.name));
  }

  async nameTaken(tx: Tx, userId: string, name: string): Promise<boolean> {
    const [row] = await tx
      .select({ id: savedViews.id })
      .from(savedViews)
      .where(and(this.mine(userId), eq(savedViews.name, name)));
    return Boolean(row);
  }

  async insert(
    tx: Tx,
    values: { tenantId: string; userId: string; name: string; layout: string; filters: object },
  ): Promise<ViewRow> {
    const [row] = await tx
      .insert(savedViews)
      .values({ ...values, entity: 'lead', filters: values.filters as Record<string, unknown> })
      .returning();
    if (!row) throw new Error('saved view insert returned nothing');
    return row;
  }

  async delete(tx: Tx, userId: string, id: string): Promise<boolean> {
    const deleted = await tx
      .delete(savedViews)
      .where(and(eq(savedViews.id, id), this.mine(userId)))
      .returning({ id: savedViews.id });
    return deleted.length > 0;
  }
}

/** Saved lead views (M1-T4): private to the user who saved them (RLS keeps them in the tenant). */
@Injectable()
export class LeadViewsService {
  constructor(
    private readonly crm: CrmService,
    private readonly repository: LeadViewsRepository,
  ) {}

  list(auth: CrmAuth): Promise<LeadViewList> {
    return this.crm.withCrm(auth, async (tx) => ({
      items: (await this.repository.list(tx, auth.userId)).map(toView),
    }));
  }

  create(auth: CrmAuth, input: CreateLeadViewRequest): Promise<LeadView> {
    return this.crm.withCrm(auth, async (tx) => {
      if (await this.repository.nameTaken(tx, auth.userId, input.name)) {
        throw new DomainError('view_name_taken', 409, 'You already have a view with this name');
      }
      return toView(
        await this.repository.insert(tx, {
          tenantId: auth.tenantId,
          userId: auth.userId,
          name: input.name,
          layout: input.layout,
          filters: input.filters,
        }),
      );
    });
  }

  async remove(auth: CrmAuth, id: string): Promise<void> {
    await this.crm.withCrm(auth, async (tx) => {
      if (!(await this.repository.delete(tx, auth.userId, id))) throw crmNotFound();
    });
  }
}
