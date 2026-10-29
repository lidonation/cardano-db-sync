import {defineConfig, devices} from '@playwright/test';

import {PROFILES} from './config/profiles';

const PORT = Number(process.env.DBS_VERSION_TEST_PORT ?? 3415);
if (!Number.isInteger(PORT) || PORT < 1024 || PORT > 65535) {
  throw new Error('DBS_VERSION_TEST_PORT must be an integer from 1024 to 65535.');
}
export const VERSION_HOME = `http://127.0.0.1:${PORT}${PROFILES.dev.baseUrl}`;

export default defineConfig({
  testDir: 'test/version-browser',
  fullyParallel: true,
  workers: 2,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: 'list',
  timeout: 60_000,
  use: {...devices['Desktop Chrome'], baseURL: VERSION_HOME, trace: 'retain-on-failure'},
  webServer: {
    command: 'node scripts/serve-version-fixture.mjs',
    url: VERSION_HOME,
    timeout: 360_000,
    reuseExistingServer: false,
    gracefulShutdown: {signal: 'SIGTERM', timeout: 5_000},
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
