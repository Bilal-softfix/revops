import { z } from 'zod';
import { leadSourceTypeSchema, stageCategorySchema } from './enums.js';

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

export const leadSourceSchema = z.object({
  id: z.uuid(),
  key: z.string().nullable(),
  name: z.string(),
  type: leadSourceTypeSchema,
  isActive: z.boolean(),
});
export type LeadSource = z.infer<typeof leadSourceSchema>;
export const leadSourceListSchema = z.object({ items: z.array(leadSourceSchema) });
export type LeadSourceList = z.infer<typeof leadSourceListSchema>;
