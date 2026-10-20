import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    passWithNoTests: true,
    include: ['packages/*/src/**/*.test.ts', 'apps/*/src/**/*.test.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      include: ['packages/core/src/**/*.ts'],
      // types.ts holds only type declarations
      exclude: ['**/*.test.ts', 'packages/core/src/test-utils.ts', 'packages/core/src/types.ts'],
      reporter: ['text', 'html'],
    },
  },
});
