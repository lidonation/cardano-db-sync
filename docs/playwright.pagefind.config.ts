import {defineConfig, devices} from '@playwright/test';

export default defineConfig({
  testDir: 'test/pagefind-browser',
  workers: 1,
  retries: 0,
  timeout: 60_000,
  reporter: 'list',
  use: {...devices['Desktop Chrome']},
});
