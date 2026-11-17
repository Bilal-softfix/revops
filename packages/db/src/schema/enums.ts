import {
  ACTOR_TYPES,
  CUSTOM_FIELD_ENTITIES,
  CUSTOM_FIELD_TYPES,
  LEAD_SOURCE_TYPES,
  MEMBERSHIP_STATUSES,
  ROLES,
  STAGE_CATEGORIES,
  TASK_STATUSES,
  TASK_TYPES,
  TENANT_STATUSES,
  TIMELINE_EVENT_TYPES,
} from '@revops/shared';
import { pgEnum } from 'drizzle-orm/pg-core';

export const tenantStatus = pgEnum('tenant_status', TENANT_STATUSES);
export const membershipRole = pgEnum('membership_role', ROLES);
export const membershipStatus = pgEnum('membership_status', MEMBERSHIP_STATUSES);
export const actorType = pgEnum('actor_type', ACTOR_TYPES);
export const stageCategory = pgEnum('stage_category', STAGE_CATEGORIES);
export const customFieldEntity = pgEnum('custom_field_entity', CUSTOM_FIELD_ENTITIES);
export const customFieldType = pgEnum('custom_field_type', CUSTOM_FIELD_TYPES);
export const leadSourceType = pgEnum('lead_source_type', LEAD_SOURCE_TYPES);
export const taskType = pgEnum('task_type', TASK_TYPES);
export const taskStatus = pgEnum('task_status', TASK_STATUSES);
export const timelineEventType = pgEnum('timeline_event_type', TIMELINE_EVENT_TYPES);
