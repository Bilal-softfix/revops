import type { z } from 'zod';
import { EVENT_TYPE_PATTERN } from './outbox.js';
import {
  MEMBER_JOINED_V1,
  USER_SIGNED_UP_V1,
  memberJoinedV1Schema,
  userSignedUpV1Schema,
} from './identity.js';

/** One outbox event type: its versioned name and the Zod schema of its payload (ids only, no PII). */
export interface EventDefinition<T extends Record<string, unknown> = Record<string, unknown>> {
  readonly type: string;
  readonly schema: z.ZodType<T>;
}

export function defineEvent<T extends Record<string, unknown>>(
  type: string,
  schema: z.ZodType<T>,
): EventDefinition<T> {
  if (!EVENT_TYPE_PATTERN.test(type)) {
    throw new Error(`invalid event type "${type}" (use <aggregate>.<verb>.v<N>)`);
  }
  return { type, schema };
}

export const USER_SIGNED_UP = defineEvent(USER_SIGNED_UP_V1, userSignedUpV1Schema);
export const MEMBER_JOINED = defineEvent(MEMBER_JOINED_V1, memberJoinedV1Schema);

/**
 * Every event type the system may write. The writer (`recordEvent`) and the relay both use it: an
 * outbox row whose type isn't here, or whose payload fails its schema, is dead-lettered by the
 * relay instead of blocking delivery. Add new events here (M1: lead.*, task.*, …).
 */
export const EVENT_REGISTRY: ReadonlyMap<string, EventDefinition> = new Map(
  [USER_SIGNED_UP, MEMBER_JOINED].map((def) => [def.type, def as EventDefinition]),
);

export function eventDefinition(type: string): EventDefinition | undefined {
  return EVENT_REGISTRY.get(type);
}
