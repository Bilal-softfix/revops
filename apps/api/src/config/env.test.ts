import { describe, expect, it } from 'vitest';
import { nestLogLevels } from './env';

describe('nestLogLevels', () => {
  it('maps info to fatal..log', () => {
    expect(nestLogLevels('info')).toEqual(['fatal', 'error', 'warn', 'log']);
  });

  it('maps trace to every level', () => {
    expect(nestLogLevels('trace')).toEqual(['fatal', 'error', 'warn', 'log', 'debug', 'verbose']);
  });

  it('maps fatal to fatal only', () => {
    expect(nestLogLevels('fatal')).toEqual(['fatal']);
  });
});
