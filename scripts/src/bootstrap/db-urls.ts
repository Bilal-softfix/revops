// Pure helpers for `pnpm run db:bootstrap`: identifiers, passwords, host + URL derivation.
// Works for a native local Postgres (ADR-012), Neon, and the CI container.
import { randomBytes } from 'node:crypto';

const IDENTIFIER = /^[a-z_][a-z0-9_]{0,62}$/;
const URL_SAFE = /^[A-Za-z0-9_-]+$/;
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

/** Only plain lowercase identifiers are accepted, so they can be safely double-quoted in DDL. */
export function assertIdentifier(kind: string, name: string): string {
  if (!IDENTIFIER.test(name)) throw new Error(`invalid ${kind} name "${name}"`);
  return name;
}

/** 32 random bytes → 43 base64url chars (256 bits). URL-safe, so no escaping in URLs or DDL. */
export function generatePassword(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/** DDL can't take bind parameters, so the literal is only built from a URL-safe string. */
export function passwordLiteral(password: string): string {
  if (!URL_SAFE.test(password)) throw new Error('password must be URL-safe base64');
  return `'${password}'`;
}

export function isLocalHost(hostname: string): boolean {
  return LOCAL_HOSTS.has(hostname);
}

export interface Hosts {
  direct: string;
  pooled: string;
  isNeon: boolean;
}

/**
 * Neon hosts look like `ep-<name>-<id>.<region>.aws.neon.tech`; the pooler endpoint inserts
 * `-pooler` after the endpoint id. Accepts either form. Every other host (localhost, a CI
 * container, a self-hosted server) has no pooler, so both are the same host.
 */
export function deriveHosts(hostname: string): Hosts {
  const [first, ...rest] = hostname.split('.');
  if (!first?.startsWith('ep-') || !hostname.endsWith('.neon.tech')) {
    return { direct: hostname, pooled: hostname, isNeon: false };
  }
  const endpoint = first.replace(/-pooler$/, '');
  return {
    direct: [endpoint, ...rest].join('.'),
    pooled: [`${endpoint}-pooler`, ...rest].join('.'),
    isNeon: true,
  };
}

/**
 * Copies `base` (keeps port + query such as sslmode) with a different host/db and optional
 * user/password. A local host without an sslmode gets `sslmode=disable`, so the URL says plainly
 * that the connection is unencrypted (a local Postgres usually has no TLS).
 */
export function withTarget(
  base: URL,
  target: { host: string; database: string; user?: string; password?: string },
): URL {
  const url = new URL(base.toString());
  url.hostname = target.host;
  url.pathname = `/${target.database}`;
  if (target.user !== undefined) url.username = target.user;
  if (target.password !== undefined) url.password = target.password;
  if (isLocalHost(url.hostname) && !url.searchParams.has('sslmode')) {
    url.searchParams.set('sslmode', 'disable');
  }
  return url;
}

const PLACEHOLDER = { app: '__APP_USER_PASSWORD__', owner: '__OWNER_PASSWORD__' } as const;

export interface EnvLineInput {
  /** Any URL on the server (host, port, sslmode are taken from it). */
  serverUrl: URL;
  owner: { role: string; password: string | null };
  app: { role: string; password: string | null };
  devDatabase: string;
  testDatabase: string;
}

/**
 * The four lines for `.env`: app role on the pooled host, owner on the direct host (the same host
 * outside Neon). A password of null (role existed, password unknown) becomes a visible
 * `<..._PASSWORD>` placeholder: never a guess.
 */
export function buildEnvLines(input: EnvLineInput): string[] {
  const hosts = deriveHosts(input.serverUrl.hostname);
  const url = (
    host: string,
    database: string,
    role: { role: string; password: string | null },
    placeholder: string,
    shown: string,
  ) =>
    withTarget(input.serverUrl, {
      host,
      database,
      user: role.role,
      password: role.password ?? placeholder,
    })
      .toString()
      .replace(placeholder, shown);
  const app = (db: string) =>
    url(hosts.pooled, db, input.app, PLACEHOLDER.app, '<APP_USER_PASSWORD>');
  const owner = (db: string) =>
    url(hosts.direct, db, input.owner, PLACEHOLDER.owner, '<OWNER_PASSWORD>');

  return [
    `DATABASE_URL=${app(input.devDatabase)}`,
    `DATABASE_URL_OWNER=${owner(input.devDatabase)}`,
    `DATABASE_URL_TEST=${app(input.testDatabase)}`,
    `DATABASE_URL_TEST_OWNER=${owner(input.testDatabase)}`,
  ];
}
