import {defineConfig, devices} from '@playwright/test';

import {PROFILES} from './config/profiles';
import {INVENTORY_ENV_VAR, INVENTORY_PATH} from './plugins/inventory';

/**
 * B29 — the component suite. Serves the component inventory from the development server (the
 * inventory is never built into a profile) and audits it in a real browser: axe in four palettes
 * at three widths, every state rendered, keyboard behaviour. Run with `npm run test:components`.
 */
const PORT = Number(process.env.DBS_TEST_PORT ?? 3100);
if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
  throw new Error('DBS_TEST_PORT must be a valid TCP port');
}
export const ORIGIN = `http://127.0.0.1:${PORT}`;

export const INVENTORY_URL = `${ORIGIN}${PROFILES.dev.baseUrl}${INVENTORY_PATH}`;

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
    // Never audit a server that may belong to a different checkout.
    reuseExistingServer: false,
    timeout: 240_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
