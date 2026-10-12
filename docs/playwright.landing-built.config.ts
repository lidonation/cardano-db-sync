import {defineConfig, devices} from '@playwright/test';

import {PROFILES} from './config/profiles';

/** Runs the landing, ecosystem and FAQ contracts on shipped CSS, which is optimized only in builds. */
export default defineConfig({
  testDir: 'test/browser',
  testMatch: ['landing.spec.ts', 'ecosystem.spec.ts', 'faq.spec.ts'],
  fullyParallel: true,
  workers: 4,
  timeout: 60_000,
  use: {...devices['Desktop Chrome'], trace: 'retain-on-failure'},
  projects: [
    {name: 'built-dev', use: {baseURL: `http://127.0.0.1:3188${PROFILES.dev.baseUrl}`}},
    {name: 'built-prod', use: {baseURL: `http://127.0.0.1:3189${PROFILES.prod.baseUrl}`}},
  ],
  webServer: [
    {
      command:
        'npx cross-env DOCS_PROFILE=dev docusaurus serve --dir build/dev --port 3188 --host 127.0.0.1 --no-open',
      url: `http://127.0.0.1:3188${PROFILES.dev.baseUrl}`,
      reuseExistingServer: false,
    },
    {
      command:
        'npx cross-env DOCS_PROFILE=prod docusaurus serve --dir build/prod --port 3189 --host 127.0.0.1 --no-open',
      url: `http://127.0.0.1:3189${PROFILES.prod.baseUrl}`,
      reuseExistingServer: false,
    },
  ],
});
