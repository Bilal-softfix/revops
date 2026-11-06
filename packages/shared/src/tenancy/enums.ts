import { z } from 'zod';

// Single source of truth for tenancy enums: the DB (pgEnum) and the API/web (Zod) both use these.

export const ROLES = ['owner', 'admin', 'manager', 'agent'] as const;
export const roleSchema = z.enum(ROLES);
export type Role = z.infer<typeof roleSchema>;

export const MEMBERSHIP_STATUSES = ['invited', 'active', 'disabled'] as const;
export const membershipStatusSchema = z.enum(MEMBERSHIP_STATUSES);
export type MembershipStatus = z.infer<typeof membershipStatusSchema>;

export const TENANT_STATUSES = ['active', 'suspended'] as const;
export const tenantStatusSchema = z.enum(TENANT_STATUSES);
export type TenantStatus = z.infer<typeof tenantStatusSchema>;

/** Who performed an audited action. */
export const ACTOR_TYPES = ['user', 'ai', 'system'] as const;
export const actorTypeSchema = z.enum(ACTOR_TYPES);
export type ActorType = z.infer<typeof actorTypeSchema>;

export const DEFAULT_TIMEZONE = 'Asia/Kolkata';
