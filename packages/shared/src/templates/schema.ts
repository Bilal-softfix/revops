import { z } from 'zod';
import { agentContactVisibilitySchema } from '../crm/settings.js';
import {
  customFieldEntitySchema,
  customFieldTypeSchema,
  keySchema,
  leadSourceTypeSchema,
  stageCategorySchema,
} from '../crm/enums.js';

// Industry templates: everything industry-specific in the CRM is DATA (this schema + the JSON
// files in ./data), never code. A template seeds a tenant's pipelines, custom fields and lead
// sources once, at provisioning; the tenant then owns and edits its copy.

const label = z.string().trim().min(1).max(100);

export const templateStageSchema = z.object({
  key: keySchema,
  name: label,
  category: stageCategorySchema,
  /** Win probability in percent (forecasting later). */
  probability: z.number().int().min(0).max(100),
});

export const templatePipelineSchema = z
  .object({
    key: keySchema,
    name: label,
    isDefault: z.boolean(),
    stages: z.array(templateStageSchema).min(1).max(30),
    /** Suggested reasons offered when a lead moves to a lost stage (free text still allowed). */
    lostReasons: z.array(label).max(20).default([]),
  })
  .superRefine((pipeline, ctx) => {
    if (!pipeline.stages.some((s) => s.category === 'open')) {
      ctx.addIssue({ code: 'custom', message: 'needs at least one open stage', path: ['stages'] });
    }
    const keys = pipeline.stages.map((s) => s.key);
    if (new Set(keys).size !== keys.length) {
      ctx.addIssue({ code: 'custom', message: 'stage keys must be unique', path: ['stages'] });
    }
  });

/** Option values may start with a digit (`1bhk`, `1l_5l`); otherwise like keys. */
export const optionValueSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9_]{0,49}$/, 'use lower_snake_case (a–z, 0–9, _)');
export const fieldOptionSchema = z.object({ value: optionValueSchema, label });

export const templateCustomFieldSchema = z
  .object({
    entity: customFieldEntitySchema,
    key: keySchema,
    label,
    type: customFieldTypeSchema,
    options: z.array(fieldOptionSchema).max(100).optional(),
    required: z.boolean().default(false),
  })
  .superRefine((field, ctx) => {
    const choice = field.type === 'select' || field.type === 'multiselect';
    if (choice && !field.options?.length) {
      ctx.addIssue({ code: 'custom', message: `${field.type} needs options`, path: ['options'] });
    }
    if (!choice && field.options) {
      ctx.addIssue({
        code: 'custom',
        message: 'only select fields have options',
        path: ['options'],
      });
    }
  });

export const templateLeadSourceSchema = z.object({
  key: keySchema,
  name: label,
  type: leadSourceTypeSchema,
});

export const industryTemplateSchema = z
  .object({
    key: z.string().regex(/^[a-z][a-z0-9-]{0,49}$/),
    name: label,
    description: z.string().trim().max(300),
    /** Default CRM settings for a tenant provisioned from this template. */
    settings: z.object({ agentContactVisibility: agentContactVisibilitySchema }),
    pipelines: z.array(templatePipelineSchema).min(1).max(10),
    customFields: z.array(templateCustomFieldSchema).max(100),
    leadSources: z.array(templateLeadSourceSchema).min(1).max(50),
  })
  .superRefine((template, ctx) => {
    const defaults = template.pipelines.filter((p) => p.isDefault).length;
    if (defaults !== 1) {
      ctx.addIssue({
        code: 'custom',
        message: 'exactly one default pipeline',
        path: ['pipelines'],
      });
    }
    const unique = (path: string, values: string[]) => {
      if (new Set(values).size !== values.length) {
        ctx.addIssue({ code: 'custom', message: `${path} keys must be unique`, path: [path] });
      }
    };
    unique(
      'pipelines',
      template.pipelines.map((p) => p.key),
    );
    unique(
      'customFields',
      template.customFields.map((f) => `${f.entity}.${f.key}`),
    );
    unique(
      'leadSources',
      template.leadSources.map((s) => s.key),
    );
  });

export type IndustryTemplate = z.infer<typeof industryTemplateSchema>;
export type TemplatePipeline = z.infer<typeof templatePipelineSchema>;
export type TemplateCustomField = z.infer<typeof templateCustomFieldSchema>;
