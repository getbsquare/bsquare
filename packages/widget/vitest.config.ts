import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    environmentOptions: {
      jsdom: {
        url: 'http://localhost/',
      },
    },
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      exclude: ['**/*.test.ts', '**/*.test.tsx', 'src/index.css'],
      reporter: ['text', 'text-summary'],
      // Floors lock in current coverage so it can't silently regress.
      // Raise these as coverage improves.
      thresholds: {
        statements: 88,
        branches: 73,
        functions: 85,
        lines: 88,
      },
    },
  },
});
