import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { loadTestDatabaseEnv } from '@revops/db/testing';
import { createDb, memberships, users, withContext } from '@revops/db';
import { CSRF_HEADER, type Role, type SessionResponse } from '@revops/shared';
import { apiEnvSchema, parseEnv } from '@revops/shared/env';
import postgres from 'postgres';
import request from 'supertest';
import { APP_OPTIONS, configureApp } from '../src/app-setup';
import { AppModule } from '../src/app.module';
import { PasswordService } from '../src/modules/identity/password.service';
import { sessionCookieName } from '../src/modules/identity/session.service';
import { BackgroundTasks, QueuedBackgroundTasks } from '../src/platform/background-tasks';
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
  /** Background work (signup processing, emails) waits here until `drain()`. */
  background: QueuedBackgroundTasks;
  drain: () => Promise<void>;
  close: () => Promise<void>;
}

/**
 * The real AppModule on the test DB, with fake email, a controllable clock and queued tasks.
 * Rate limits live in Postgres (ADR-011), so each new app starts with empty buckets — the same
 * isolation the per-app in-memory limiter used to give. Safe: integration files run one at a time.
 */
export async function createTestApp(): Promise<TestApp> {
  const { appUrl } = loadTestDatabaseEnv();
  await asTestOwner((sql) => sql`truncate rate_limit_buckets`);
  const env = parseEnv(apiEnvSchema, {
    ...process.env,
    DATABASE_URL: appUrl,
    EMAIL_DRIVER: 'fake',
    APP_URL: 'http://localhost:3000',
    COOKIE_SECURE: 'true',
  });
  const clock = new FakeClock(new Date());
  const background = new QueuedBackgroundTasks();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule.register(env)] })
    .overrideProvider(Clock)
    .useValue(clock)
    .overrideProvider(BackgroundTasks)
    .useValue(background)
    .compile();
  const app = moduleRef.createNestApplication({ ...APP_OPTIONS, logger: false });
  configureApp(app);
  await app.init();
  return {
    app,
    server: app.getHttpServer() as Server,
    clock,
    email: app.get<EmailProvider, FakeEmailProvider>(EmailProvider),
    background,
    drain: () => background.drain(),
    close: () => app.close(),
  };
}

export const uniqueEmail = (label = 'user') => `${label}-${randomUUID()}@example.test`;

/** `__Host-sid=<token>` from a Set-Cookie response (Secure, so supertest agents won't resend it). */
export function sessionCookie(res: request.Response): string {
  const raw = ([] as string[]).concat(res.headers['set-cookie'] ?? []);
  const cookie = raw.find((c) => c.startsWith(`${SESSION_COOKIE}=`));
  if (!cookie) throw new Error('no session cookie set');
  return cookie.split(';')[0] ?? '';
}

/** POST /signup (always 202) and run the background processing. */
export async function signup(
  t: TestApp,
  email: string,
  password = PASSWORD,
  tenantName = 'Asha Realty',
): Promise<request.Response> {
  const res = await request(t.server)
    .post('/v1/auth/signup')
    .send({ name: 'Asha', email, password, tenantName })
    .expect(202);
  await t.drain();
  return res;
}

export const verify = (t: TestApp, token: string | undefined, password = PASSWORD) =>
  request(t.server).post('/v1/auth/verify-email').send({ token, password });

/** Signup + verify (with the password) and return the logged-in session (user/tenant ids). */
export async function signupVerified(t: TestApp, email: string, password = PASSWORD) {
  await signup(t, email, password);
  await verify(t, t.email.lastTokenTo(email), password).expect(204);
  return (await login(t, email, password)).body;
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

/**
 * Owner connection to the TEST database, for setting up states the API can't produce (e.g.
 * backdating an account past the 48 h cutoff). users isn't FORCE RLS, so the owner sees all rows.
 */
export async function asTestOwner<T>(fn: (sql: postgres.Sql) => Promise<T>): Promise<T> {
  const sql = postgres(loadTestDatabaseEnv().ownerUrl, { max: 1, onnotice: () => undefined });
  try {
    return await fn(sql);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

/** Ages an unverified signup past the 48 h cutoff. */
export const expireSignup = (email: string) =>
  asTestOwner(
    (sql) => sql`update users set created_at = now() - interval '49 hours' where email = ${email}`,
  );

/**
 * Adds a verified user with `role` to the tenant directly in the test DB (through RLS, as
 * app_user), password PASSWORD. Much faster than invite + accept for role-matrix tests.
 */
export async function addMember(
  t: TestApp,
  tenantId: string,
  role: Role,
  status: 'active' | 'disabled' = 'active',
): Promise<{ userId: string; email: string }> {
  const userId = randomUUID();
  const email = uniqueEmail(role);
  const passwordHash = await t.app.get(PasswordService).hash(PASSWORD);
  const db = createDb(loadTestDatabaseEnv().appUrl, { max: 1 });
  try {
    await withContext(db.db, { tenantId, userId }, async (tx) => {
      await tx.insert(users).values({
        id: userId,
        email,
        name: `${role} user`,
        passwordHash,
        emailVerifiedAt: new Date(),
      });
      await tx.insert(memberships).values({ tenantId, userId, role, status });
    });
  } finally {
    await db.close();
  }
  return { userId, email };
}
