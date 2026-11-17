import { z } from 'zod';

/**
 * Which contacts an agent may see (owners, admins and managers always see all):
 * - `all`: every contact in the tenant (walk-in counters, front desks);
 * - `assigned`: contacts they created or that are linked to leads assigned to them.
 * Lead visibility follows assignment in both modes. Default comes from the industry template.
 */
export const AGENT_CONTACT_VISIBILITY = ['all', 'assigned'] as const;
export const agentContactVisibilitySchema = z.enum(AGENT_CONTACT_VISIBILITY);
export type AgentContactVisibility = z.infer<typeof agentContactVisibilitySchema>;

/** Per-tenant CRM settings (GET/PATCH /v1/crm/settings). */
export const crmSettingsSchema = z.object({
  agentContactVisibility: agentContactVisibilitySchema,
  /**
   * Agents may export CSV of their own (assigned) leads (M1-T6 review). Default false: only
   * owners, admins and managers (`lead.export`) export.
   */
  allowAgentExport: z.boolean(),
});
export type CrmSettings = z.infer<typeof crmSettingsSchema>;

export const updateCrmSettingsRequestSchema = crmSettingsSchema
  .partial()
  .refine((body) => Object.keys(body).length > 0, { message: 'nothing to update' });
export type UpdateCrmSettingsRequest = z.infer<typeof updateCrmSettingsRequestSchema>;
