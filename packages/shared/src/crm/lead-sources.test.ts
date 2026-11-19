import { describe, expect, it } from 'vitest';
import { leadSourceConfigSchema, originSchema } from './lead-sources.js';

describe('originSchema', () => {
  it.each([
    ['https://Shop.Example.com/', 'https://shop.example.com'],
    ['https://example.com:443', 'https://example.com'],
    ['http://localhost:5173', 'http://localhost:5173'],
  ])('accepts %s as %s', (input, origin) => {
    expect(originSchema.parse(input)).toBe(origin);
  });

  it.each([
    'https://example.com/path',
    'https://example.com/?q=1',
    'https://example.com#x',
    'https://user:pw@example.com',
    'javascript:alert(1)',
    'ftp://example.com',
    'example.com',
    '*',
  ])('rejects %s', (input) => {
    expect(originSchema.safeParse(input).success).toBe(false);
  });
});

describe('leadSourceConfigSchema', () => {
  it('fills defaults from {}', () => {
    expect(leadSourceConfigSchema.parse({})).toEqual({
      allowedOrigins: [],
      captcha: false,
      fieldMapping: {},
      pipelineId: null,
      stageId: null,
      assignment: { strategy: 'round_robin' },
      webhookAuth: 'hmac',
    });
  });

  it('webhookAuth: hmac (default) or token; nothing else', () => {
    expect(leadSourceConfigSchema.parse({ webhookAuth: 'token' }).webhookAuth).toBe('token');
    expect(leadSourceConfigSchema.safeParse({ webhookAuth: 'url' }).success).toBe(false);
  });

  it('dedupes origins after normalising', () => {
    expect(
      leadSourceConfigSchema.parse({
        allowedOrigins: ['https://A.com', 'https://a.com/', 'https://a.com:443'],
      }).allowedOrigins,
    ).toEqual(['https://a.com']);
  });

  it.each([
    [{ fieldMapping: { constructor: 'name' } }],
    [{ fieldMapping: { 'a/b': 'name' } }],
    [{ fieldMapping: { x: 'lead.Bad' } }],
    [{ fieldMapping: { x: 'notes' } }],
    [
      {
        fieldMapping: Object.fromEntries(Array.from({ length: 51 }, (_, i) => [`f${i}`, 'lead.x'])),
      },
    ],
    [{ allowedOrigins: Array.from({ length: 21 }, (_, i) => `https://s${i}.com`) }],
    [{ assignment: { strategy: 'user' } }],
    [{ extra: 1 }],
  ])('rejects %j', (input) => {
    expect(leadSourceConfigSchema.safeParse(input).success).toBe(false);
  });
});
