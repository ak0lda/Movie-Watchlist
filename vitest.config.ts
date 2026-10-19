import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: ['packages/core', 'apps/app'],
    // packages/core has no tests until stage 2.
    passWithNoTests: true,
  },
});
