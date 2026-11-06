// Pure .env text editing for `db:bootstrap --write-env`: replace/add/remove keys, keep every other
// line (comments, blanks, unrelated vars) and the file's line endings as they were.

const LINE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/;

export type EnvChange = 'added' | 'replaced' | 'unchanged' | 'removed';

function unquote(raw: string): string {
  const value = raw.trim();
  const quote = value[0];
  if ((quote === '"' || quote === "'") && value.length >= 2 && value.endsWith(quote)) {
    return value.slice(1, -1);
  }
  return value.replace(/\s+#.*$/, '');
}

/** Value of the last `KEY=` line (last wins, like dotenv), or undefined. */
export function readEnvValue(content: string, key: string): string | undefined {
  let found: string | undefined;
  for (const line of content.split(/\r?\n/)) {
    const match = LINE.exec(line);
    if (match?.[1] === key) found = unquote(match[2] ?? '');
  }
  return found;
}

/** Keys defined more than once → their 1-based line numbers (the last one wins when loaded). */
export function duplicateKeys(content: string): Map<string, number[]> {
  const seen = new Map<string, number[]>();
  content.split(/\r?\n/).forEach((line, i) => {
    const key = LINE.exec(line)?.[1];
    if (key !== undefined) seen.set(key, [...(seen.get(key) ?? []), i + 1]);
  });
  return new Map([...seen].filter(([, lines]) => lines.length > 1));
}

export interface EnvEdit {
  content: string;
  changes: Map<string, EnvChange>;
}

/**
 * Sets each key in `set` (first occurrence replaced in place, later duplicates dropped, missing
 * keys appended) and deletes every key in `remove`. Values are written unquoted.
 */
export function editEnv(
  content: string,
  set: ReadonlyMap<string, string>,
  remove: readonly string[] = [],
): EnvEdit {
  const eol = content.includes('\r\n') ? '\r\n' : '\n';
  const lines = content === '' ? [] : content.split(/\r?\n/);
  if (lines.at(-1) === '') lines.pop(); // trailing newline
  const changes = new Map<string, EnvChange>();
  const out: string[] = [];

  for (const line of lines) {
    const key = LINE.exec(line)?.[1];
    if (key !== undefined && remove.includes(key)) {
      changes.set(key, 'removed');
      continue;
    }
    if (key !== undefined && set.has(key)) {
      if (changes.has(key)) continue; // duplicate of a key already written
      const value = set.get(key) ?? '';
      changes.set(key, unquote(LINE.exec(line)?.[2] ?? '') === value ? 'unchanged' : 'replaced');
      out.push(`${key}=${value}`);
      continue;
    }
    out.push(line);
  }

  for (const [key, value] of set) {
    if (changes.has(key)) continue;
    out.push(`${key}=${value}`);
    changes.set(key, 'added');
  }
  return { content: out.length ? `${out.join(eol)}${eol}` : '', changes };
}
