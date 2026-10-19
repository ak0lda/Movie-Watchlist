import { defineConfig } from '@playwright/test';

// Real Electron end-to-end tests. They are serial because each test launches app instances with
// private user-data folders and a local WebDAV server.
export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [['list']],
});
