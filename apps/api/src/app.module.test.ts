import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { apiEnvSchema, parseEnv } from '@revops/shared/env';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { APP_OPTIONS, configureApp, trustProxySetting } from './app-setup';
import { AppModule } from './app.module';

// No database needed: the pool connects lazily and these routes never query it.
const env = parseEnv(apiEnvSchema, {
  DATABASE_URL: 'postgresql://app_user:unused@127.0.0.1:1/revops_dev',
  EMAIL_DRIVER: 'fake',
  LOG_LEVEL: 'fatal',
  METRICS_TOKEN: 'test-metrics-token-0123',
});

describe('AppModule (http)', () => {
  let app: INestApplication;
  let server: Server;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule.register(env)],
    }).compile();
    app = moduleRef.createNestApplication({ ...APP_OPTIONS, logger: false });
    configureApp(app);
    await app.init();
    server = app.getHttpServer() as Server;
  }, 30_000); // boots the whole app (incl. the argon2 dummy-hash warm-up): slow on a busy machine

  afterAll(async () => {
    await app.close();
  });

  it('GET /health → 200 ok', async () => {
    const res = await request(server).get('/health').expect(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('unknown route → 404 as problem+json', async () => {
    const res = await request(server).get('/nope').expect(404);
    expect(res.headers['content-type']).toMatch(/^application\/problem\+json/);
    expect(res.body).toMatchObject({ status: 404, code: 'not_found' });
  });

  it('invalid body → 400 validation_failed listing paths, never values', async () => {
    const res = await request(server)
      .post('/v1/auth/signup')
      .send({ email: 'nope', password: 'secret-x' })
      .expect(400);
    expect(res.body).toMatchObject({ code: 'validation_failed', status: 400 });
    expect(JSON.stringify(res.body)).not.toContain('secret-x');
    expect((res.body as { errors: { path: string }[] }).errors.map((e) => e.path)).toEqual(
      expect.arrayContaining(['name', 'email', 'password', 'tenantName']),
    );
  });

  it('protected route without a session → 401 unauthenticated', async () => {
    const res = await request(server).get('/v1/auth/me').expect(401);
    expect(res.body).toMatchObject({ code: 'unauthenticated' });
  });

  it('malformed JSON → 400 problem+json, no stack trace', async () => {
    const res = await request(server)
      .post('/v1/auth/login')
      .set('content-type', 'application/json')
      .send('{"email": ')
      .expect(400);
    expect(res.headers['content-type']).toMatch(/^application\/problem\+json/);
    expect(res.body).toMatchObject({ code: 'malformed_json' });
    expect(res.text).not.toMatch(/at .*\.js:\d+/);
  });

  it('a body over 100kb → 413 problem+json', async () => {
    const res = await request(server)
      .post('/v1/auth/login')
      .send({ email: 'a@b.co', password: 'x'.repeat(200_000) })
      .expect(413);
    expect(res.body).toMatchObject({ code: 'payload_too_large' });
  });

  it('does not advertise the framework', async () => {
    const res = await request(server).get('/health');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('every response carries x-request-id; a safe client id is echoed, and errors include it', async () => {
    const generated = await request(server).get('/health');
    expect(generated.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    const echoed = await request(server).get('/nope').set('x-request-id', 'trace-abc.1');
    expect(echoed.headers['x-request-id']).toBe('trace-abc.1');
    expect(echoed.body).toMatchObject({ requestId: 'trace-abc.1' });
  });

  it('GET /ready → 503 problem+json naming the failing checks when the DB is down', async () => {
    const res = await request(server).get('/ready').expect(503);
    expect(res.headers['content-type']).toMatch(/^application\/problem\+json/);
    expect(res.body).toMatchObject({
      code: 'not_ready',
      checks: { database: 'fail', queue: 'fail' },
    });
  });

  it('GET /metrics needs the bearer token and exposes Prometheus text with route templates', async () => {
    await request(server).get('/metrics').expect(401);
    await request(server)
      .get('/metrics')
      .set('authorization', 'Bearer wrong-token-0000000')
      .expect(401);
    const res = await request(server)
      .get('/metrics')
      .set('authorization', 'Bearer test-metrics-token-0123')
      .expect(200);
    expect(res.headers['content-type']).toMatch(/^text\/plain/);
    expect(res.text).toContain('http_request_duration_seconds_count');
    expect(res.text).toMatch(/route="\/health"/);
  });

  it('OpenAPI at /docs/openapi.json: v1 routes with Zod request schemas, probes excluded', async () => {
    const res = await request(server).get('/docs/openapi.json').expect(200);
    const doc = res.body as {
      paths: Record<string, Record<string, Record<string, unknown>>>;
      components: { schemas: Record<string, unknown> };
    };
    expect(Object.keys(doc.paths)).toEqual(
      expect.arrayContaining([
        '/v1/auth/signup',
        '/v1/auth/login',
        '/v1/members',
        '/v1/invitations',
      ]),
    );
    for (const probe of ['/health', '/ready', '/metrics']) expect(doc.paths[probe]).toBeUndefined();
    const signup = doc.paths['/v1/auth/signup']?.post;
    expect(signup?.requestBody).toMatchObject({
      content: {
        'application/json': {
          schema: {
            type: 'object',
            required: expect.arrayContaining([
              'name',
              'email',
              'password',
              'tenantName',
            ]) as unknown,
          },
        },
      },
    });
    expect(signup?.responses).toHaveProperty('default');
    expect(doc.components.schemas).toHaveProperty('Problem');
    const list = doc.paths['/v1/members']?.get?.parameters as { name: string; in: string }[];
    expect(list.filter((p) => p.in === 'query').map((p) => p.name)).toEqual(
      expect.arrayContaining(['limit']),
    );
  });

  it('Swagger UI is served at /docs outside production', async () => {
    const res = await request(server).get('/docs').redirects(1);
    expect(res.status).toBe(200);
    expect(res.text).toMatch(/swagger/i);
  });
});

describe('trustProxySetting', () => {
  it.each([
    ['false', false],
    ['loopback', 'loopback'],
    ['2', 2],
    ['10.0.0.0/8, 192.168.0.0/16', '10.0.0.0/8, 192.168.0.0/16'],
  ])('%s → %s', (input, expected) => expect(trustProxySetting(input)).toBe(expected));
});
