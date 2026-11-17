import { z } from 'zod';
import clinic from './data/clinic.json' with { type: 'json' };
import education from './data/education.json' with { type: 'json' };
import generic from './data/generic.json' with { type: 'json' };
import realEstate from './data/real-estate.json' with { type: 'json' };
import repairShop from './data/repair-shop.json' with { type: 'json' };
import softwareAgency from './data/software-agency.json' with { type: 'json' };
import { type IndustryTemplate, industryTemplateSchema } from './schema.js';

export * from './schema.js';

/** Template keys, in the order the signup picker shows them (generic last: "Other"). */
export const INDUSTRY_TEMPLATE_KEYS = [
  'software-agency',
  'repair-shop',
  'real-estate',
  'education',
  'clinic',
  'generic',
] as const;
export const industryTemplateKeySchema = z.enum(INDUSTRY_TEMPLATE_KEYS);
export type IndustryTemplateKey = z.infer<typeof industryTemplateKeySchema>;
export const DEFAULT_INDUSTRY_TEMPLATE: IndustryTemplateKey = 'generic';

const RAW: Record<IndustryTemplateKey, unknown> = {
  'software-agency': softwareAgency,
  'repair-shop': repairShop,
  'real-estate': realEstate,
  education,
  clinic,
  generic,
};

/**
 * Every industry template, validated at import: a broken JSON file fails at startup and in CI
 * (shared unit tests), never half-provisions a tenant.
 */
export const INDUSTRY_TEMPLATES: Readonly<Record<IndustryTemplateKey, IndustryTemplate>> =
  Object.fromEntries(
    INDUSTRY_TEMPLATE_KEYS.map((key) => {
      const template = industryTemplateSchema.parse(RAW[key]);
      if (template.key !== key)
        throw new Error(`template file for "${key}" says "${template.key}"`);
      return [key, template];
    }),
  ) as Record<IndustryTemplateKey, IndustryTemplate>;

/** The template for a stored key; unknown/null keys fall back to `generic`. */
export function industryTemplate(key: string | null | undefined): IndustryTemplate {
  const parsed = industryTemplateKeySchema.safeParse(key);
  return INDUSTRY_TEMPLATES[parsed.success ? parsed.data : DEFAULT_INDUSTRY_TEMPLATE];
}
