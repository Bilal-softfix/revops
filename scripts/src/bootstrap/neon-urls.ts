// Pure helpers for `pnpm run db:bootstrap`: identifiers, passwords, Neon host + URL derivation.
import { randomBytes } from 'node:crypto';

const IDENTIFIER = /^[a-z_][a-z0-9_]{0,62}$/;
const URL_SAFE = /^[A-Za-z0-9_-]+$/;
const APP_PASSWORD_PLACEHOLDER = '__APP_USER_PASSWORD__';

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

export interface Hosts {
  direct: string;
  pooled: string;
  isNeon: boolean;
}

/**
 * Neon hosts look like `ep-<name>-<id>.<region>.aws.neon.tech`; the pooler endpoint inserts
 * `-pooler` after the endpoint id. Accepts either form. Non-Neon hosts (e.g. a CI container)
 * have no pooler, so both are the same host.
 */
export function deriveHosts(hostname: string): Hosts {
  const [first, ...rest] = hostname.split('.');
  if (!first?.startsWith('ep-')) return { direct: hostname, pooled: hostname, isNeon: false };
  const endpoint = first.replace(/-pooler$/, '');
  return {
    direct: [endpoint, ...rest].join('.'),
    pooled: [`${endpoint}-pooler`, ...rest].join('.'),
    isNeon: true,
  };
}

/** Copies `base` (keeps port + query such as sslmode) with a different host/db and optional user. */
export function withTarget(
  base: URL,
  target: { host: string; database: string; user?: string; password?: string },
): URL {
  const url = new URL(base.toString());
  url.hostname = target.host;
  url.pathname = `/${target.database}`;
  if (target.user !== undefined) url.username = target.user;
  if (target.password !== undefined) url.password = target.password;
  return url;
}

export interface EnvLineInput {
  ownerUrl: URL;
  appRole: string;
  /** null when the role already existed: the password is unknown and must not be shown. */
  appPassword: string | null;
  devDatabase: string;
  testDatabase: string;
}

/** The four lines for `.env`: app_user on the pooled endpoint, owner on the direct one. */
export function buildEnvLines(input: EnvLineInput): string[] {
  const hosts = deriveHosts(input.ownerUrl.hostname);
  const app = (database: string) =>
    withTarget(input.ownerUrl, {
      host: hosts.pooled,
      database,
      user: input.appRole,
      password: input.appPassword ?? APP_PASSWORD_PLACEHOLDER,
    })
      .toString()
      .replace(APP_PASSWORD_PLACEHOLDER, '<APP_USER_PASSWORD>');
  const owner = (database: string) =>
    withTarget(input.ownerUrl, { host: hosts.direct, database }).toString();

  return [
    `DATABASE_URL=${app(input.devDatabase)}`,
    `DATABASE_URL_OWNER=${owner(input.devDatabase)}`,
    `DATABASE_URL_TEST=${app(input.testDatabase)}`,
    `DATABASE_URL_TEST_OWNER=${owner(input.testDatabase)}`,
  ];
}
