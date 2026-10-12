import {defineConfig} from 'vitest/config';

/**
 * B08 schema replay tests. They replay every migration into a real Postgres 17 (libpq environment),
 * so they run as a separate suite (`npm run test:schema-db`) in the extract-schema workflow, not
 * alongside the unit tests.
 */
export default defineConfig({
  test: {
    include: ['test/db/**/*.test.ts'],
    environment: 'node',
    globals: true,
    testTimeout: 180_000,
    hookTimeout: 180_000,
  },
});
