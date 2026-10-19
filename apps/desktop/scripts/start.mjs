// `start`: build the renderer and the Electron bundles, then launch the app from app://.
// `start --dev`: serve the renderer from the Vite dev server instead (hot reload, no CSP header).
import { spawn, spawnSync } from 'node:child_process';
import electronPath from 'electron';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const desktopDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(desktopDir, '../..');
const dev = process.argv.includes('--dev');
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';

function run(args) {
  const result = spawnSync(pnpm, args, {
    cwd: repoRoot,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

async function waitFor(url, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // Not up yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

run(['--filter', '@movie-watchlist/desktop', 'build']);

const env = { ...process.env };
let viteServer;
if (dev) {
  const port = 5173;
  viteServer = spawn(
    pnpm,
    ['--filter', '@movie-watchlist/app', 'dev', '--port', String(port), '--strictPort'],
    {
      cwd: repoRoot,
      stdio: 'inherit',
      shell: process.platform === 'win32',
    },
  );
  await waitFor(`http://localhost:${port}/`);
  env.MW_RENDERER_URL = `http://localhost:${port}`;
} else {
  run(['--filter', '@movie-watchlist/app', 'build']);
}

const electron = spawn(electronPath, ['.'], { cwd: desktopDir, stdio: 'inherit', env });
electron.on('exit', (code) => {
  viteServer?.kill();
  process.exit(code ?? 0);
});
