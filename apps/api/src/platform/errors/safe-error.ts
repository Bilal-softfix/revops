/**
 * A log-safe description of an error: class name, Postgres SQLSTATE/constraint, and the stack
 * frames — never `message`. drizzle wraps query failures as "Failed query: <sql> params: <params>",
 * and those params can be emails, names or password hashes (CLAUDE.md rules 6–7). pino redaction in
 * M0-T6 builds on this.
 */
export function safeErrorSummary(error: unknown): string {
  if (!(error instanceof Error)) return `non-error thrown (${typeof error})`;
  const parts = [error.name];
  for (const source of [error, (error as { cause?: unknown }).cause]) {
    const pg = source as { code?: unknown; constraint_name?: unknown } | undefined;
    if (typeof pg?.code === 'string') parts.push(`code=${pg.code}`);
    if (typeof pg?.constraint_name === 'string') parts.push(`constraint=${pg.constraint_name}`);
  }
  const frames = (error.stack ?? '')
    .split('\n')
    .filter((line) => line.trimStart().startsWith('at '))
    .join('\n');
  return frames ? `${parts.join(' ')}\n${frames}` : parts.join(' ');
}
