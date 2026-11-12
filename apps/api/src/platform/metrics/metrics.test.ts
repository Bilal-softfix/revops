import { describe, expect, it } from 'vitest';
import { Metrics, metricsAuthorized } from './metrics';

describe('metrics', () => {
  it('metricsAuthorized: open without a token, Bearer match otherwise', () => {
    expect(metricsAuthorized(undefined, undefined)).toBe(true);
    const token = 'a-very-long-metrics-token';
    expect(metricsAuthorized(`Bearer ${token}`, token)).toBe(true);
    expect(metricsAuthorized(undefined, token)).toBe(false);
    expect(metricsAuthorized(`Bearer ${token}x`, token)).toBe(false);
    expect(metricsAuthorized(token, token)).toBe(false);
  });

  it('labels HTTP timings by route template, not the raw path', async () => {
    const metrics = new Metrics('revops-test', { defaultMetrics: false });
    const middleware = metrics.httpMiddleware();
    const listeners: (() => void)[] = [];
    const req = { method: 'GET', baseUrl: '', route: { path: '/v1/members/:userId' } };
    const res = { statusCode: 200, on: (_: string, fn: () => void) => listeners.push(fn) };
    middleware(req as never, res as never, () => undefined);
    listeners.forEach((fn) => fn());
    const text = await metrics.registry.metrics();
    expect(text).toContain('route="/v1/members/:userId"');
    expect(text).toContain('service="revops-test"');
  });
});
