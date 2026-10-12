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
        // B34: the navbar's derived sections and the docs section lookup. The layout itself is
        // audited per tier in a real browser by test:components.
        'src/theme/Navbar/items.ts',
        'src/theme/DocLayout/sections.ts',
        // B44-a: the landing page's build facts and route-gated surfaces.
        'src/data/release-facts.ts',
        'src/data/surfaces.ts',
        // B44-c: the FAQ questions and their FAQPage JSON-LD.
        'src/faq/questions.ts',
        'src/faq/jsonld.ts',
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
