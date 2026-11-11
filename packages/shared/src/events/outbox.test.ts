import { describe, expect, it } from 'vitest';
import { EVENT_TYPE_PATTERN, outboxEnvelopeSchema } from './outbox.js';

const valid = {
  eventId: '00000000-0000-4000-8000-000000000001',
  tenantId: '00000000-0000-4000-8000-000000000002',
  type: 'user.signed_up.v1',
  aggregateId: null,
  payload: { userId: '00000000-0000-4000-8000-000000000003' },
  occurredAt: '2026-11-11T08:00:00.000Z',
};

describe('outboxEnvelopeSchema', () => {
  it('accepts a well-formed envelope', () => {
    expect(outboxEnvelopeSchema.parse(valid)).toEqual(valid);
  });

  it.each([
    ['eventId', 'not-a-uuid'],
    ['tenantId', ''],
    ['type', 'user.signed_up'],
    ['payload', 'x'],
    ['occurredAt', 'yesterday'],
  ])('rejects a bad %s', (key, value) => {
    expect(outboxEnvelopeSchema.safeParse({ ...valid, [key]: value }).success).toBe(false);
  });

  it('event types are versioned dotted names', () => {
    expect(EVENT_TYPE_PATTERN.test('member.joined.v1')).toBe(true);
    expect(EVENT_TYPE_PATTERN.test('Member.joined.v1')).toBe(false);
    expect(EVENT_TYPE_PATTERN.test('member.joined.v0')).toBe(false);
  });
});
