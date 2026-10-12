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
        'src/lib/palette.ts',
        'src/wallet/**/*.ts',
        // The browser-free i18n helpers. The hooks and theme components that use them need a
        // Docusaurus build and are covered by test:build.
        'src/i18n/pages.ts',
        'src/i18n/identifier.ts',
        'src/survey/labelIds.ts',
        // The config schema validator shared by check:config and the config wizard (B10).
        'src/data/**/*.mjs',
        // B29: the component manifest and the browser-free component logic. The components
        // themselves are audited in a real browser by test:components.
        'src/components/inventory.ts',
        'src/components/shared/states.ts',
        'src/components/Tabs/keyboard.ts',
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
