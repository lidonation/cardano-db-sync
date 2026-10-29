import path from 'node:path';

import {defineConfig, devices} from '@playwright/test';

import {PROFILES} from './config/profiles';

const PORT = Number(process.env.DBS_LANDING_BUILT_TEST_PORT ?? 3188);
if (!Number.isInteger(PORT) || PORT < 1024 || PORT > 65534) {
  throw new Error('DBS_LANDING_BUILT_TEST_PORT must be an integer from 1024 to 65534.');
}

const buildRoot = path.resolve(process.env.DBS_LANDING_BUILT_BUILD_ROOT ?? 'build');
const shellQuote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;

/** Runs the landing, FAQ and Ecosystem contracts on shipped CSS, which is optimized only in builds. */
export default defineConfig({
  testDir: 'test/browser',
  testMatch: ['landing.spec.ts', 'faq.spec.ts', 'ecosystem.spec.ts', 'commit-activity.spec.ts'],
  fullyParallel: true,
  workers: 4,
  timeout: 60_000,
  use: {...devices['Desktop Chrome'], trace: 'retain-on-failure'},
  projects: [
    {name: 'built-dev', use: {baseURL: `http://127.0.0.1:${PORT}${PROFILES.dev.baseUrl}`}},
    {name: 'built-prod', use: {baseURL: `http://127.0.0.1:${PORT + 1}${PROFILES.prod.baseUrl}`}},
  ],
  webServer: [
    {
      command: `npx cross-env DOCS_PROFILE=dev docusaurus serve --dir ${shellQuote(path.join(buildRoot, 'dev'))} --port ${PORT} --host 127.0.0.1 --no-open`,
      url: `http://127.0.0.1:${PORT}${PROFILES.dev.baseUrl}`,
      reuseExistingServer: false,
    },
    {
      command: `npx cross-env DOCS_PROFILE=prod docusaurus serve --dir ${shellQuote(path.join(buildRoot, 'prod'))} --port ${PORT + 1} --host 127.0.0.1 --no-open`,
      url: `http://127.0.0.1:${PORT + 1}${PROFILES.prod.baseUrl}`,
      reuseExistingServer: false,
    },
  ],
});
