import {defineConfig, devices} from '@playwright/test';

import {PROFILES} from './config/profiles';
import {INVENTORY_ENV_VAR, INVENTORY_PATH, LAYOUT_FIXTURE_PATH} from './plugins/inventory';

/**
 * B29 — the component suite. Serves the component inventory from the development server (the
 * inventory is never built into a profile) and audits it in a real browser: axe in four palettes
 * at three widths, every state rendered, keyboard behaviour. B34 adds the responsive docs layout,
 * run against fixture docs behind the same flag. Run with `npm run test:components`.
 */
const PORT = 3100;
const ORIGIN = `http://127.0.0.1:${PORT}`;

export const SITE_URL = `${ORIGIN}${PROFILES.dev.baseUrl}`;
export const INVENTORY_URL = `${SITE_URL}${INVENTORY_PATH}`;
/** B34's fixture docs: sections and a long page with a table of contents. */
export const LAYOUT_URL = `${SITE_URL}${LAYOUT_FIXTURE_PATH}`;

export default defineConfig({
  testDir: 'test/browser',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: process.env.CI ? [['list'], ['github']] : 'list',
  timeout: 60_000,
  use: {
    ...devices['Desktop Chrome'],
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `npx cross-env ${INVENTORY_ENV_VAR}=1 DOCS_PROFILE=dev docusaurus start --port ${PORT} --host 127.0.0.1 --no-open`,
    url: INVENTORY_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 240_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
