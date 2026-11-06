import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { apiEnvSchema, parseEnv } from '@revops/shared/env';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { APP_OPTIONS, configureApp } from './app-setup';
import { AppModule } from './app.module';

// No database needed: the pool connects lazily and these routes never query it.
const env = parseEnv(apiEnvSchema, {
  DATABASE_URL: 'postgresql://app_user:unused@127.0.0.1:1/revops_dev',
  EMAIL_DRIVER: 'fake',
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
  });

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
});
