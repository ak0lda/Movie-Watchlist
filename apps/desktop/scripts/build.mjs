// Bundles the main process and the preload script to CommonJS (Electron loads both with require).
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const common = {
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  external: ['electron'],
  sourcemap: true,
  logLevel: 'info',
};

await Promise.all([
  build({
    ...common,
    entryPoints: [path.join(root, 'src/main/index.ts')],
    outfile: path.join(root, 'dist/main.cjs'),
  }),
  build({
    ...common,
    entryPoints: [path.join(root, 'src/preload/index.ts')],
    outfile: path.join(root, 'dist/preload.cjs'),
  }),
]);
