import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { EVENT_REGISTRY, USER_SIGNED_UP, defineEvent, eventDefinition } from './registry.js';

describe('event registry', () => {
  it('rejects unversioned or malformed event types at definition time', () => {
    for (const bad of ['lead.created', 'Lead.created.v1', 'lead.v1', 'lead.created.v0']) {
      expect(() => defineEvent(bad, z.object({}))).toThrow(/invalid event type/);
    }
  });

  it('knows every M0 event and validates its payload', () => {
    expect([...EVENT_REGISTRY.keys()].sort()).toEqual([
      'contact.created.v1',
      'member.joined.v1',
      'user.signed_up.v1',
    ]);
    const def = eventDefinition('user.signed_up.v1');
    expect(def).toBe(USER_SIGNED_UP);
    expect(def?.schema.safeParse({ userId: 'x' }).success).toBe(false);
    expect(eventDefinition('nobody.listens.v1')).toBeUndefined();
  });
});
