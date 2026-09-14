import {defineConfig} from 'vitest/config';

/**
 * Build-level tests. They shell out to a real `docusaurus build`, so they are slow and run as a
 * separate suite (`npm run test:build`) rather than alongside the unit tests.
 */
export default defineConfig({
  test: {
    include: ['test/build/**/*.test.ts'],
    environment: 'node',
    globals: true,
    testTimeout: 600_000,
    hookTimeout: 600_000,
    fileParallelism: false,
  },
});
