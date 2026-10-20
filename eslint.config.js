import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import prettier from 'eslint-config-prettier';
import i18next from 'eslint-plugin-i18next';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig(
  globalIgnores([
    '**/dist/**',
    '**/node_modules/**',
    '**/android/**',
    'spike/**',
    '.omc/**',
    'apps/desktop/renderer/**',
    'apps/desktop/release/**',
    'installers/**',
  ]),
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
  },
  {
    // UI strings must go through i18n keys: literals in JSX (text and attributes) are errors.
    files: ['apps/app/src/**/*.tsx'],
    plugins: { i18next, 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'i18next/no-literal-string': ['error', { mode: 'jsx-only' }],
    },
  },
  prettier,
);
