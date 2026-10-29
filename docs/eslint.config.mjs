import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      'build/**',
      '.cache/browser-fixtures/**',
      '.docusaurus/**',
      'node_modules/**',
      'coverage/**',
      'test/fixtures/**',
      'test-results/**',
      'playwright-report/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: {
        process: 'readonly',
        console: 'readonly',
        __dirname: 'readonly',
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        {argsIgnorePattern: '^_', varsIgnorePattern: '^_'},
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: "Literal[value='/cardano-db-sync/']",
          message: 'ENV-1: the developer baseUrl lives in config/profiles.ts only.',
        },
      ],
    },
  },
  {
    // The profile module is the one place the literal belongs (ENV-1); the gate script and the
    // tests have to name it to check for it.
    files: ['config/profiles.ts', 'test/**/*.ts', 'scripts/**/*.mjs'],
    rules: {
      'no-restricted-syntax': 'off',
    },
  },
);
