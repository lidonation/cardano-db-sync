import {defineConfig, devices} from '@playwright/test';

import {PROFILES} from './config/profiles';

const PORT = Number(process.env.DBS_BUILT_TEST_PORT ?? 3101);
if (!Number.isInteger(PORT) || PORT < 1024 || PORT > 65535) {
  throw new Error('DBS_BUILT_TEST_PORT must be an integer from 1024 to 65535.');
}
export const BUILT_HOME = `http://127.0.0.1:${PORT}${PROFILES.dev.baseUrl}`;

/** Real static output: all locales and the exact CSP-hashed scripts, before hydration. */
export default defineConfig({
  testDir: 'test/built-browser',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: 'list',
  timeout: 30_000,
  use: {...devices['Desktop Chrome'], trace: 'retain-on-failure'},
  webServer: {
    command: `npm run build:dev && npx cross-env DOCS_PROFILE=dev docusaurus serve --dir build/dev --port ${PORT} --host 127.0.0.1 --no-open`,
    url: BUILT_HOME,
    reuseExistingServer: false,
    timeout: 240_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
