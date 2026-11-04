import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { z } from 'zod';

/** Walks up from `start` to the directory containing pnpm-workspace.yaml. */
export function findRepoRoot(start: string = process.cwd()): string {
  let dir = resolve(start);
  for (;;) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) throw new Error(`No pnpm-workspace.yaml found above ${start}`);
    dir = parent;
  }
}

/**
 * Loads .env files into process.env without overriding values that are already set,
 * so precedence is: real environment > first file > later files. Missing files are skipped
 * (production gets its env from the platform, not files).
 */
export function loadEnvFiles(paths: readonly string[]): string[] {
  const loaded: string[] = [];
  for (const path of paths) {
    if (!existsSync(path)) continue;
    process.loadEnvFile(path);
    loaded.push(path);
  }
  return loaded;
}

/** Standard order for an app: `apps/<app>/.env`, then the repo root `.env`. */
export function loadAppEnv(appDir: string): string[] {
  const root = findRepoRoot(appDir);
  return loadEnvFiles([join(appDir, '.env'), join(root, '.env')]);
}

export class EnvValidationError extends Error {
  constructor(readonly issues: readonly string[]) {
    super(`Invalid environment:\n  - ${issues.join('\n  - ')}`);
    this.name = 'EnvValidationError';
  }
}

/** Formats Zod issues as `VAR: message` without ever echoing the value. */
export function formatEnvIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`);
}

export function parseEnv<S extends z.ZodType>(
  schema: S,
  env: NodeJS.ProcessEnv = process.env,
): z.infer<S> {
  const result = schema.safeParse(env);
  if (!result.success) throw new EnvValidationError(formatEnvIssues(result.error));
  return result.data;
}
