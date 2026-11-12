import { describe, expect, it } from 'vitest';
import { editEnv, readEnvValue } from './env-file.js';

const set = (entries: Record<string, string>) => new Map(Object.entries(entries));

describe('readEnvValue', () => {
  it('reads plain, quoted, exported and last-wins values', () => {
    const content = [
      '# comment',
      'A=1',
      'export B="two words"',
      "C='x'",
      'A=override',
      'D=v # trailing comment',
    ].join('\n');
    expect(readEnvValue(content, 'A')).toBe('override');
    expect(readEnvValue(content, 'B')).toBe('two words');
    expect(readEnvValue(content, 'C')).toBe('x');
    expect(readEnvValue(content, 'D')).toBe('v');
    expect(readEnvValue(content, 'MISSING')).toBeUndefined();
  });
});

describe('editEnv', () => {
  it('replaces in place, keeps other lines, appends missing keys, removes requested keys', () => {
    const before = [
      '# Neon',
      'NEON_BOOTSTRAP_URL=postgresql://owner:pw@h/neondb',
      'DATABASE_URL=old',
      '',
      'SEED_PASSWORD=x',
    ].join('\n');
    const { content, changes } = editEnv(
      `${before}\n`,
      set({ DATABASE_URL: 'new', DATABASE_URL_TEST: 't' }),
      ['NEON_BOOTSTRAP_URL'],
    );
    expect(content).toBe(
      ['# Neon', 'DATABASE_URL=new', '', 'SEED_PASSWORD=x', 'DATABASE_URL_TEST=t', ''].join('\n'),
    );
    expect(Object.fromEntries(changes)).toEqual({
      NEON_BOOTSTRAP_URL: 'removed',
      DATABASE_URL: 'replaced',
      DATABASE_URL_TEST: 'added',
    });
  });

  it('is idempotent: a second edit with the same values reports unchanged and same bytes', () => {
    const first = editEnv('X=1\n', set({ DATABASE_URL: 'a' }), ['NEON_BOOTSTRAP_URL']);
    const second = editEnv(first.content, set({ DATABASE_URL: 'a' }), ['NEON_BOOTSTRAP_URL']);
    expect(second.content).toBe(first.content);
    expect(Object.fromEntries(second.changes)).toEqual({ DATABASE_URL: 'unchanged' });
  });

  it('keeps CRLF line endings and drops duplicate keys', () => {
    const { content } = editEnv('A=1\r\nB=2\r\nA=3\r\n', set({ A: 'x' }));
    expect(content).toBe('A=x\r\nB=2\r\n');
  });

  it('creates content for an empty or missing file', () => {
    expect(editEnv('', set({ A: '1', B: '2' })).content).toBe('A=1\nB=2\n');
  });

  it('adds a newline when the file had none at the end', () => {
    expect(editEnv('A=1', set({ B: '2' })).content).toBe('A=1\nB=2\n');
  });
});
