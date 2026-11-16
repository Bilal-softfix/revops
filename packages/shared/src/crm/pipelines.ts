import { z } from 'zod';
import { stageCategorySchema } from './enums.js';
import type { StageCategory } from './enums.js';

// Pipeline & stage management (M1-T3b): request contracts for /v1/pipelines/*. Response shapes
// (pipelineSchema, stageSchema) live in ./schemas.ts.

const name = z.string().trim().min(1, 'can’t be empty').max(100);
const probability = z.number().int().min(0).max(100);
const lostReasons = z
  .array(z.string().trim().min(1).max(100))
  .max(20)
  .refine((list) => new Set(list.map((r) => r.toLowerCase())).size === list.length, {
    message: 'duplicate reasons',
  });

/** Win probability a new stage gets when none is given. */
export const DEFAULT_STAGE_PROBABILITY: Readonly<Record<StageCategory, number>> = {
  open: 50,
  won: 100,
  lost: 0,
};

export const createStageRequestSchema = z.object({
  name,
  category: stageCategorySchema,
  probability: probability.optional(),
});
export type CreateStageRequest = z.infer<typeof createStageRequestSchema>;

/** Stages a new pipeline gets when the request has none. */
export const DEFAULT_NEW_PIPELINE_STAGES: readonly CreateStageRequest[] = [
  { name: 'New', category: 'open', probability: 20 },
  { name: 'In progress', category: 'open', probability: 50 },
  { name: 'Won', category: 'won', probability: 100 },
  { name: 'Lost', category: 'lost', probability: 0 },
];

const uniqueNames = (stages: readonly { name: string }[]) =>
  new Set(stages.map((s) => s.name.toLowerCase())).size === stages.length;

export const createPipelineRequestSchema = z.object({
  name,
  stages: z
    .array(createStageRequestSchema)
    .min(1)
    .max(30)
    .refine((stages) => stages.some((s) => s.category === 'open'), {
      message: 'needs at least one open stage',
    })
    .refine(uniqueNames, { message: 'stage names must be unique' })
    .optional(),
  lostReasons: lostReasons.optional(),
});
export type CreatePipelineRequest = z.infer<typeof createPipelineRequestSchema>;

/** `isDefault` can only be switched on: another pipeline becomes the default by being chosen. */
export const updatePipelineRequestSchema = z
  .strictObject({
    name,
    lostReasons,
    isDefault: z.literal(true, { error: 'make another pipeline the default instead' }),
  })
  .partial()
  .refine((body) => Object.keys(body).length > 0, { message: 'nothing to update' });
export type UpdatePipelineRequest = z.infer<typeof updatePipelineRequestSchema>;

/** Category can change only while the stage holds no leads (checked by the API). */
export const updateStageRequestSchema = z
  .strictObject({ name, category: stageCategorySchema, probability })
  .partial()
  .refine((body) => Object.keys(body).length > 0, { message: 'nothing to update' });
export type UpdateStageRequest = z.infer<typeof updateStageRequestSchema>;

const idList = z
  .array(z.uuid())
  .min(1)
  .max(100)
  .refine((ids) => new Set(ids).size === ids.length, { message: 'duplicate ids' });

/** The full new order: every active pipeline (or every stage of the pipeline) exactly once. */
export const reorderPipelinesRequestSchema = z.object({ pipelineIds: idList });
export type ReorderPipelinesRequest = z.infer<typeof reorderPipelinesRequestSchema>;
export const reorderStagesRequestSchema = z.object({ stageIds: idList });
export type ReorderStagesRequest = z.infer<typeof reorderStagesRequestSchema>;

/**
 * Deleting a stage that holds leads needs a target stage in the same pipeline, with the same
 * category (so leads never become won/lost without won_at / a lost reason).
 */
export const deleteStageQuerySchema = z.object({ moveTo: z.uuid().optional() });
export type DeleteStageQuery = z.infer<typeof deleteStageQuerySchema>;

/** 409 `stage_has_leads` extension: how many leads must move, and where they may go. */
export const stageHasLeadsSchema = z.object({
  leadCount: z.number().int(),
  targetStageIds: z.array(z.uuid()),
});
export type StageHasLeads = z.infer<typeof stageHasLeadsSchema>;
