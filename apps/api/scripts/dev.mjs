// Cross-platform dev runner: one tsc watcher + `node --watch` for each entrypoint (http + worker).
// tsc is used (not esbuild/tsx) because Nest DI needs emitDecoratorMetadata.
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const appDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const tsc = createRequire(import.meta.url).resolve('typescript/bin/tsc');
const node = process.execPath;

const initial = spawnSync(node, [tsc, '-p', 'tsconfig.build.json'], {
  cwd: appDir,
  stdio: 'inherit',
});
if (initial.status !== 0) process.exit(initial.status ?? 1);

const children = [
  [node, [tsc, '-p', 'tsconfig.build.json', '--watch', '--preserveWatchOutput']],
  [node, ['--watch', '--enable-source-maps', 'dist/main.js']],
  [node, ['--watch', '--enable-source-maps', 'dist/worker.js']],
].map(([cmd, args]) => spawn(cmd, args, { cwd: appDir, stdio: 'inherit' }));

let shuttingDown = false;
function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) if (child.exitCode === null) child.kill();
  process.exitCode = code;
}

for (const child of children) child.on('exit', (code) => shutdown(code ?? 0));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => shutdown(0));
