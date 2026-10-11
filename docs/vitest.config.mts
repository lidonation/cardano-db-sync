import {defineConfig} from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/unit/**/*.test.ts'],
    environment: 'node',
    globals: true,
    coverage: {
      provider: 'v8',
      include: [
        'config/**/*.ts',
        'plugins/**/*.ts',
        'scripts/**/*.mjs',
        'src/wallet/**/*.ts',
        // The browser-free i18n helpers. The hooks and theme components that use them need a
        // Docusaurus build and are covered by test:build.
        'src/i18n/pages.ts',
        'src/i18n/identifier.ts',
        'src/survey/labelIds.ts',
        'docusaurus.config.ts',
      ],
      reporter: ['text-summary', 'json-summary'],
      reportsDirectory: 'coverage',
      thresholds: {
        lines: 90,
        functions: 90,
        statements: 90,
        branches: 80,
      },
    },
  },
});
