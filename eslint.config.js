import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.expo/**',
      '**/coverage/**',
      'supabase/functions/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: {
      'no-console': 'error', // never log financial data
    },
  },
  {
    // The scripts' single console channels: counts, settings and totals only.
    files: ['scripts/import/src/console.ts', 'scripts/prices/src/console.ts'],
    rules: { 'no-console': 'off' },
  },
  {
    // Expo's CommonJS config files (Babel, Metro, Jest).
    files: ['apps/mobile/*.js'],
    languageOptions: { sourceType: 'commonjs', globals: { ...globals.node, ...globals.jest } },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
  prettier,
);
