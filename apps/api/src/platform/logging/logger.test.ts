import type { IncomingMessage } from 'node:http';
import pino from 'pino';
import { describe, expect, it } from 'vitest';
import { baseLoggerOptions, errorSerializer, requestIdFor } from './logger';

function capture() {
  const lines: Record<string, unknown>[] = [];
  const logger = pino(baseLoggerOptions('info', 'revops-test'), {
    write: (line: string) => lines.push(JSON.parse(line) as Record<string, unknown>),
  });
  return { logger, lines };
}

describe('pino config', () => {
  it('masks emails and phones in the message and in logged objects', () => {
    const { logger, lines } = capture();
    logger.info(
      { to: 'asha@example.com', nested: { phone: '+919876543210' } },
      'mail for ravi@example.in',
    );
    expect(lines[0]).toMatchObject({
      msg: 'mail for r***@example.in',
      to: 'a***@example.com',
      nested: { phone: '+91******3210' },
      service: 'revops-test',
    });
  });

  it('redacts secrets wherever they appear', () => {
    const { logger, lines } = capture();
    logger.info({
      req: { headers: { authorization: 'Bearer abc', cookie: 'sid=1', 'x-csrf-token': 'csrf-v' } },
      body: { password: 'hunter2hunter2', token: 'tok-v' },
    });
    const text = JSON.stringify(lines[0]);
    for (const secret of ['Bearer abc', 'sid=1', 'hunter2hunter2', 'tok-v', 'csrf-v']) {
      expect(text).not.toContain(secret);
    }
    expect(text).toContain('[redacted]');
  });

  it('logs errors without their message (drizzle puts query params there)', () => {
    const error = Object.assign(new Error('Failed query: ... params: asha@example.com,hash'), {
      code: '23505',
    });
    const out = errorSerializer(error);
    expect(out).toMatchObject({ type: 'Error', code: '23505' });
    expect(JSON.stringify(out)).not.toContain('asha@example.com');
  });

  it('keeps a safe client request id, otherwise generates one', () => {
    const req = (id?: string) => ({ headers: id ? { 'x-request-id': id } : {} }) as IncomingMessage;
    const uuid = /^[0-9a-f-]{36}$/;
    expect(requestIdFor(req('abc-123'))).toBe('abc-123');
    expect(requestIdFor(req('bad id <script>'))).toMatch(uuid);
    expect(requestIdFor(req('x'.repeat(200)))).toMatch(uuid);
    expect(requestIdFor(req())).toMatch(uuid);
  });
});
