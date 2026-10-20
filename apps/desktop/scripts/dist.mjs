// `dist`: builds the renderer and the Electron bundles, copies the renderer next to them and packs an
// installer with electron-builder (Windows: NSIS .exe in release/). Config: electron-builder.yml.
import { spawnSync } from 'node:child_process';
import { cpSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const desktopDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(desktopDir, '../..');
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';

function run(args, cwd = repoRoot) {
  const result = spawnSync(pnpm, args, {
    cwd,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run(['--filter', '@movie-watchlist/app', 'build']);
run(['--filter', '@movie-watchlist/desktop', 'build']);

const rendererOut = path.join(desktopDir, 'renderer');
rmSync(rendererOut, { recursive: true, force: true });
cpSync(path.join(repoRoot, 'apps/app/dist'), rendererOut, { recursive: true });

run(['exec', 'electron-builder', '--publish', 'never', ...process.argv.slice(2)], desktopDir);
