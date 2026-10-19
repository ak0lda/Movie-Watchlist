import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  test: {
    name: 'app',
    environment: 'node',
    // Must run before Dexie is imported: it captures the IndexedDB global at load time.
    setupFiles: ['fake-indexeddb/auto'],
  },
});
