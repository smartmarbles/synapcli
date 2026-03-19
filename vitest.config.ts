import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/lib/**', 'src/utils/**', 'src/commands/**'],
      thresholds: {
        lines:      100,
        functions:  100,
        branches:   100,
        statements: 100,
      },
    },
  },
});
