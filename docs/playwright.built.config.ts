import {existsSync} from 'node:fs';
import path from 'node:path';

import {defineConfig, devices} from '@playwright/test';

import {PROFILES, isProfileName} from './config/profiles';

const PORT = Number(process.env.DBS_BUILT_TEST_PORT ?? 3101);
if (!Number.isInteger(PORT) || PORT < 1024 || PORT > 65535) {
  throw new Error('DBS_BUILT_TEST_PORT must be an integer from 1024 to 65535.');
}
const profile = process.env.DBS_BUILT_PROFILE ?? 'dev';
if (!isProfileName(profile)) throw new Error('DBS_BUILT_PROFILE must be dev or prod.');
const skipBuild = process.env.DBS_BUILT_SKIP_BUILD;
if (skipBuild !== undefined && skipBuild !== '1') {
  throw new Error('DBS_BUILT_SKIP_BUILD, when set, must be 1.');
}
const buildRoot = path.resolve(process.env.DBS_BUILT_BUILD_ROOT ?? 'build');
const directory = path.join(buildRoot, profile);
if (skipBuild && !existsSync(path.join(directory, 'index.html'))) {
  throw new Error(`Missing ${profile} build: run npm run build before the browser suite.`);
}
const shellQuote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
export const BUILT_HOME = `http://127.0.0.1:${PORT}${PROFILES[profile].baseUrl}`;

/** Real static output: all locales and the exact CSP-hashed scripts, before hydration. */
export default defineConfig({
  testDir: 'test/built-browser',
  // Prism runs against its own temporary built fixture, not the published scaffold.
  testIgnore: '**/prism.spec.ts',
  fullyParallel: true,
  workers: 4,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: 'list',
  timeout: 60_000,
  use: {
    ...devices['Desktop Chrome'],
    baseURL: BUILT_HOME,
    viewport: {width: 1440, height: 900},
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `${skipBuild ? '' : `npm run build:${profile} && `}npx cross-env DOCS_PROFILE=${profile} docusaurus serve --dir ${shellQuote(directory)} --port ${PORT} --host 127.0.0.1 --no-open`,
    url: BUILT_HOME,
    reuseExistingServer: false,
    timeout: 240_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
