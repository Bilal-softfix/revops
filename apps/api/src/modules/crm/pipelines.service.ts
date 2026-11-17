import { Injectable } from '@nestjs/common';
import type { Tx } from '@revops/db';
import {
  type CreatePipelineRequest,
  type CreateStageRequest,
  DEFAULT_NEW_PIPELINE_STAGES,
  DEFAULT_STAGE_PROBABILITY,
  type Pipeline,
  type PipelineList,
  type StageHasLeads,
  type UpdatePipelineRequest,
  type UpdateStageRequest,
} from '@revops/shared';
import { Clock } from '../../platform/clock';
import { DomainError } from '../../platform/errors/domain-error';
import { recordAudit } from '../../platform/outbox/record';
import type { RequestMeta } from '../../platform/request-meta';
import { type CrmAuth, CrmService } from './crm.service';
import { CrmRepository } from './crm.repository';
import { ActivitiesRepository } from './activities.repository';
import { crmNotFound } from './errors';
import { PipelinesRepository } from './pipelines.repository';

const invalid = (path: string, message: string) =>
  new DomainError('validation_failed', 400, 'Invalid request', {
    extensions: { errors: [{ path, message }] },
  });
const conflict = (code: string, title: string, extensions?: Record<string, unknown>) =>
  new DomainError(code, 409, title, extensions ? { extensions } : {});
const sameSet = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && new Set([...a, ...b]).size === a.length;
const lower = (s: string) => s.trim().toLowerCase();

/**
 * Pipelines & stages (M1-T3b): create, rename, set default, lost reasons, reorder, delete; stages
 * add/edit/reorder/delete. Owners/admins (`pipeline.manage`); every change is audited.
 *
 * Invariants: exactly one default pipeline (can't be deleted); every pipeline keeps at least one
 * open stage; a stage holding leads can't change category, and is deleted only by moving its
 * leads to another stage of the same pipeline and category (the AC's "bulk move").
 */
@Injectable()
export class PipelinesService {
  constructor(
    private readonly crm: CrmService,
    private readonly read: CrmRepository,
    private readonly repository: PipelinesRepository,
    private readonly activities: ActivitiesRepository,
    private readonly clock: Clock,
  ) {}

  create(auth: CrmAuth, input: CreatePipelineRequest, meta: RequestMeta): Promise<Pipeline> {
    return this.crm.withCrm(auth, async (tx) => {
      await this.repository.lockAll(tx);
      if (await this.repository.nameTaken(tx, input.name)) throw pipelineNameTaken();
      const row = await this.repository.insert(tx, {
        tenantId: auth.tenantId,
        name: input.name,
        position: await this.repository.nextPosition(tx),
        lostReasons: input.lostReasons ?? [],
      });
      const stages = input.stages ?? DEFAULT_NEW_PIPELINE_STAGES;
      await this.repository.insertStages(
        tx,
        stages.map((stage, position) => this.stageValues(auth, row.id, stage, position)),
      );
      await this.audit(tx, auth, meta, 'pipeline.created', 'pipeline', row.id, {
        stages: stages.length,
      });
      return this.get(tx, row.id);
    });
  }

  update(
    auth: CrmAuth,
    id: string,
    input: UpdatePipelineRequest,
    meta: RequestMeta,
  ): Promise<Pipeline> {
    return this.crm.withCrm(auth, async (tx) => {
      if (input.isDefault) await this.repository.lockAll(tx);
      const current = await this.repository.lock(tx, id);
      if (!current) throw crmNotFound();
      if (input.name !== undefined && (await this.repository.nameTaken(tx, input.name, id))) {
        throw pipelineNameTaken();
      }
      if (input.isDefault && !current.isDefault) await this.repository.clearDefault(tx);
      await this.repository.update(tx, id, input);
      await this.audit(tx, auth, meta, 'pipeline.updated', 'pipeline', id, {
        fields: Object.keys(input).sort(),
      });
      return this.get(tx, id);
    });
  }

  /** Soft delete. Not the default pipeline, and only once it holds no leads. */
  async remove(auth: CrmAuth, id: string, meta: RequestMeta): Promise<void> {
    await this.crm.withCrm(auth, async (tx) => {
      const current = await this.repository.lock(tx, id);
      if (!current) throw crmNotFound();
      if (current.isDefault) {
        throw conflict(
          'pipeline_is_default',
          'The default pipeline can’t be deleted — make another pipeline the default first',
        );
      }
      const leadCount = await this.repository.leadCount(tx, { pipelineId: id });
      if (leadCount > 0) {
        throw conflict(
          'pipeline_has_leads',
          'This pipeline still has leads — move or delete them first',
          { leadCount },
        );
      }
      await this.repository.softDelete(tx, id, this.clock.now());
      await this.audit(tx, auth, meta, 'pipeline.deleted', 'pipeline', id, {});
    });
  }

  /** The full new order of the tenant's active pipelines. */
  reorder(auth: CrmAuth, pipelineIds: string[], meta: RequestMeta): Promise<PipelineList> {
    return this.crm.withCrm(auth, async (tx) => {
      const all = await this.repository.lockAll(tx);
      if (
        !sameSet(
          pipelineIds,
          all.map((p) => p.id),
        )
      ) {
        throw invalid('pipelineIds', 'list every pipeline exactly once');
      }
      await this.repository.setPipelinePositions(tx, pipelineIds);
      await this.audit(tx, auth, meta, 'pipeline.reordered', 'tenant', auth.tenantId, {});
      return { items: await this.read.listPipelines(tx) };
    });
  }

  addStage(
    auth: CrmAuth,
    pipelineId: string,
    input: CreateStageRequest,
    meta: RequestMeta,
  ): Promise<Pipeline> {
    return this.crm.withCrm(auth, async (tx) => {
      if (!(await this.repository.lock(tx, pipelineId))) throw crmNotFound();
      const stages = await this.repository.stages(tx, pipelineId);
      if (stages.length >= 30) throw invalid('name', 'a pipeline can have at most 30 stages');
      if (stages.some((s) => lower(s.name) === lower(input.name))) throw stageNameTaken();
      const position = stages.reduce((max, s) => Math.max(max, s.position + 1), 0);
      const [row] = await this.repository.insertStages(tx, [
        this.stageValues(auth, pipelineId, input, position),
      ]);
      await this.audit(tx, auth, meta, 'pipeline_stage.created', 'pipeline_stage', row?.id ?? '', {
        pipelineId,
        category: input.category,
      });
      return this.get(tx, pipelineId);
    });
  }

  updateStage(
    auth: CrmAuth,
    pipelineId: string,
    stageId: string,
    input: UpdateStageRequest,
    meta: RequestMeta,
  ): Promise<Pipeline> {
    return this.crm.withCrm(auth, async (tx) => {
      if (!(await this.repository.lock(tx, pipelineId))) throw crmNotFound();
      const stages = await this.repository.stages(tx, pipelineId);
      const stage = stages.find((s) => s.id === stageId);
      if (!stage) throw crmNotFound();
      if (
        input.name !== undefined &&
        stages.some((s) => s.id !== stageId && lower(s.name) === lower(input.name ?? ''))
      ) {
        throw stageNameTaken();
      }
      if (input.category !== undefined && input.category !== stage.category) {
        if (stage.category === 'open' && openCount(stages) === 1) throw lastOpenStage();
        const leadCount = await this.repository.leadCount(tx, { stageId });
        if (leadCount > 0) {
          throw conflict(
            'stage_category_locked',
            'This stage has leads, so its category can’t change — add a new stage instead',
            { leadCount },
          );
        }
      }
      await this.repository.updateStage(tx, stageId, input);
      await this.audit(tx, auth, meta, 'pipeline_stage.updated', 'pipeline_stage', stageId, {
        pipelineId,
        fields: Object.keys(input).sort(),
      });
      return this.get(tx, pipelineId);
    });
  }

  /** The full new order of the pipeline's stages. */
  reorderStages(
    auth: CrmAuth,
    pipelineId: string,
    stageIds: string[],
    meta: RequestMeta,
  ): Promise<Pipeline> {
    return this.crm.withCrm(auth, async (tx) => {
      if (!(await this.repository.lock(tx, pipelineId))) throw crmNotFound();
      const stages = await this.repository.stages(tx, pipelineId);
      if (
        !sameSet(
          stageIds,
          stages.map((s) => s.id),
        )
      ) {
        throw invalid('stageIds', 'list every stage of this pipeline exactly once');
      }
      await this.repository.setStagePositions(tx, stageIds);
      await this.audit(tx, auth, meta, 'pipeline.stages_reordered', 'pipeline', pipelineId, {});
      return this.get(tx, pipelineId);
    });
  }

  /**
   * AC: a stage with leads is deleted only together with a target stage (`moveTo`) of the same
   * pipeline and category; its leads are moved there in the same transaction. Without one the
   * API answers 409 `stage_has_leads` with the lead count and the allowed targets.
   */
  deleteStage(
    auth: CrmAuth,
    pipelineId: string,
    stageId: string,
    moveTo: string | undefined,
    meta: RequestMeta,
  ): Promise<Pipeline> {
    return this.crm.withCrm(auth, async (tx) => {
      if (!(await this.repository.lock(tx, pipelineId))) throw crmNotFound();
      // FOR UPDATE on the stages too: a concurrent lead insert into this stage (its FK check takes
      // KEY SHARE on the stage row) waits for us, then fails cleanly on the deleted stage.
      const stages = await this.repository.stages(tx, pipelineId, { lock: true });
      const stage = stages.find((s) => s.id === stageId);
      if (!stage) throw crmNotFound();
      if (stage.category === 'open' && openCount(stages) === 1) throw lastOpenStage();
      const targets = stages.filter((s) => s.id !== stageId && s.category === stage.category);
      if (moveTo !== undefined && !targets.some((s) => s.id === moveTo)) {
        throw invalid('moveTo', `choose another ${stage.category} stage of this pipeline`);
      }
      const leadCount = await this.repository.leadCount(tx, { stageId });
      if (leadCount > 0 && moveTo === undefined) {
        const body: StageHasLeads = { leadCount, targetStageIds: targets.map((s) => s.id) };
        throw conflict(
          'stage_has_leads',
          targets.length > 0
            ? 'This stage has leads — choose a stage to move them to'
            : `This stage has leads and there is no other ${stage.category} stage to move them to — add one first`,
          body,
        );
      }
      // Soft-deleted leads still reference the stage: they go to the target (or any stage left).
      const destination = moveTo ?? targets[0]?.id ?? stages.find((s) => s.id !== stageId)?.id;
      const now = this.clock.now();
      const movedLeads = destination
        ? await this.repository.moveLeads(tx, stageId, destination, now)
        : [];
      const moved = movedLeads.length;
      // Dev decision (M1-T3b #4): one timeline entry per moved lead; no per-lead
      // lead.stage_changed.v1, and the single audit row below.
      const to = stages.find((s) => s.id === destination);
      await this.activities.insertTimeline(
        tx,
        movedLeads.map((lead) => ({
          tenantId: auth.tenantId,
          leadId: lead.id,
          contactId: lead.contactId,
          type: 'stage_changed' as const,
          actorType: 'user' as const,
          actorId: auth.userId,
          data: {
            fromStage: { id: stage.id, name: stage.name },
            stage: { id: destination ?? '', name: to?.name ?? '' },
            reason: 'stage_deleted',
          },
          occurredAt: now,
        })),
      );
      await this.repository.deleteStage(tx, stageId);
      await this.repository.setStagePositions(
        tx,
        stages.filter((s) => s.id !== stageId).map((s) => s.id),
      );
      await this.audit(tx, auth, meta, 'pipeline_stage.deleted', 'pipeline_stage', stageId, {
        pipelineId,
        movedLeads: moved,
        ...(moved > 0 && destination ? { movedTo: destination } : {}),
      });
      return this.get(tx, pipelineId);
    });
  }

  private async get(tx: Tx, id: string): Promise<Pipeline> {
    const pipeline = await this.read.getPipeline(tx, id);
    if (!pipeline) throw crmNotFound();
    return pipeline;
  }

  private stageValues(
    auth: CrmAuth,
    pipelineId: string,
    stage: CreateStageRequest,
    position: number,
  ) {
    return {
      tenantId: auth.tenantId,
      pipelineId,
      name: stage.name,
      category: stage.category,
      probability: stage.probability ?? DEFAULT_STAGE_PROBABILITY[stage.category],
      position,
    };
  }

  private audit(
    tx: Tx,
    auth: CrmAuth,
    meta: RequestMeta,
    action: string,
    entity: string,
    entityId: string,
    after: Record<string, unknown>,
  ) {
    return recordAudit(tx, {
      tenantId: auth.tenantId,
      actorType: 'user',
      actorId: auth.userId,
      action,
      entity,
      entityId,
      after,
      ip: meta.ip,
    });
  }
}

const openCount = (stages: readonly { category: string }[]) =>
  stages.filter((s) => s.category === 'open').length;
const pipelineNameTaken = () =>
  new DomainError('pipeline_name_taken', 409, 'A pipeline with this name already exists');
const stageNameTaken = () =>
  new DomainError('stage_name_taken', 409, 'This pipeline already has a stage with this name');
const lastOpenStage = () =>
  new DomainError('last_open_stage', 409, 'A pipeline needs at least one open stage');
