import { ACTOR_TYPES, MEMBERSHIP_STATUSES, ROLES, TENANT_STATUSES } from '@revops/shared';
import { pgEnum } from 'drizzle-orm/pg-core';

export const tenantStatus = pgEnum('tenant_status', TENANT_STATUSES);
export const membershipRole = pgEnum('membership_role', ROLES);
export const membershipStatus = pgEnum('membership_status', MEMBERSHIP_STATUSES);
export const actorType = pgEnum('actor_type', ACTOR_TYPES);
