import { z } from 'zod';
import { stageCategorySchema } from './enums.js';

// CRM API contracts (/v1/pipelines, /v1/lead-sources …), shared by apps/api and apps/web.

export const stageSchema = z.object({
  id: z.uuid(),
  key: z.string().nullable(),
  name: z.string(),
  category: stageCategorySchema,
  probability: z.number().int(),
  position: z.number().int(),
});
export type Stage = z.infer<typeof stageSchema>;

export const pipelineSchema = z.object({
  id: z.uuid(),
  key: z.string().nullable(),
  name: z.string(),
  isDefault: z.boolean(),
  position: z.number().int(),
  lostReasons: z.array(z.string()),
  stages: z.array(stageSchema),
});
export type Pipeline = z.infer<typeof pipelineSchema>;
export const pipelineListSchema = z.object({ items: z.array(pipelineSchema) });
export type PipelineList = z.infer<typeof pipelineListSchema>;

// Lead source contracts live in ./lead-sources.ts (M2-T1).
