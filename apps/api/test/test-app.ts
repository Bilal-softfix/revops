import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { loadTestDatabaseEnv } from '@revops/db/testing';
import { CSRF_HEADER, type SessionResponse } from '@revops/shared';
import { apiEnvSchema, parseEnv } from '@revops/shared/env';
import request from 'supertest';
import { APP_OPTIONS, configureApp } from '../src/app-setup';
import { AppModule } from '../src/app.module';
import { sessionCookieName } from '../src/modules/identity/session.service';
import { Clock, FakeClock } from '../src/platform/clock';
import { EmailProvider, FakeEmailProvider } from '../src/providers/email';

export const SESSION_COOKIE = sessionCookieName(true);
export const PASSWORD = 'correct horse battery staple';

export interface TestApp {
  app: INestApplication;
  server: Server;
  /** Starts at real "now" so DB-side checks (expires_at > now()) agree with the app's clock. */
  clock: FakeClock;
  email: FakeEmailProvider;
  close: () => Promise<void>;
}

/** The real AppModule on the test DB, with the fake email driver and a controllable clock. */
export async function createTestApp(): Promise<TestApp> {
  const { appUrl } = loadTestDatabaseEnv();
  const env = parseEnv(apiEnvSchema, {
    ...process.env,
    DATABASE_URL: appUrl,
    EMAIL_DRIVER: 'fake',
    APP_URL: 'http://localhost:3000',
    COOKIE_SECURE: 'true',
  });
  const clock = new FakeClock(new Date());
  const moduleRef = await Test.createTestingModule({ imports: [AppModule.register(env)] })
    .overrideProvider(Clock)
    .useValue(clock)
    .compile();
  const app = moduleRef.createNestApplication({ ...APP_OPTIONS, logger: false });
  configureApp(app);
  await app.init();
  return {
    app,
    server: app.getHttpServer() as Server,
    clock,
    email: app.get<EmailProvider, FakeEmailProvider>(EmailProvider),
    close: () => app.close(),
  };
}

export const uniqueEmail = (label = 'user') => `${label}-${randomUUID()}@example.test`;

/** `sid=<token>` from a Set-Cookie response (the cookie is Secure, so supertest agents won't resend it). */
export function sessionCookie(res: request.Response): string {
  const raw = ([] as string[]).concat(res.headers['set-cookie'] ?? []);
  const cookie = raw.find((c) => c.startsWith(`${SESSION_COOKIE}=`));
  if (!cookie) throw new Error('no session cookie set');
  return cookie.split(';')[0] ?? '';
}

export async function signup(t: TestApp, email: string, password = PASSWORD) {
  const res = await request(t.server)
    .post('/v1/auth/signup')
    .send({ name: 'Asha', email, password, tenantName: 'Asha Realty' })
    .expect(201);
  return res.body as { user: { id: string }; tenant: { id: string } };
}

export async function signupVerified(t: TestApp, email: string, password = PASSWORD) {
  const body = await signup(t, email, password);
  const token = t.email.lastTokenTo(email);
  await request(t.server).post('/v1/auth/verify-email').send({ token }).expect(204);
  return body;
}

export interface LoggedIn {
  cookie: string;
  csrf: string;
  body: SessionResponse;
}

export async function login(t: TestApp, email: string, password = PASSWORD): Promise<LoggedIn> {
  const res = await request(t.server).post('/v1/auth/login').send({ email, password }).expect(200);
  const body = res.body as SessionResponse;
  return { cookie: sessionCookie(res), csrf: body.csrfToken, body };
}

export const withSession = (req: request.Test, session: LoggedIn, csrf = true) =>
  csrf
    ? req.set('Cookie', session.cookie).set(CSRF_HEADER, session.csrf)
    : req.set('Cookie', session.cookie);
