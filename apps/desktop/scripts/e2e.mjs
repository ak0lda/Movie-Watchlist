// Builds the renderer and the Electron bundles, then runs the Playwright suite against them.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const desktopDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(desktopDir, '../..');
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';

function run(args, cwd) {
  const result = spawnSync(pnpm, args, {
    cwd,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run(['--filter', '@movie-watchlist/app', 'build'], repoRoot);
run(['--filter', '@movie-watchlist/desktop', 'build'], repoRoot);
run(['exec', 'playwright', 'test', ...process.argv.slice(2)], desktopDir);
