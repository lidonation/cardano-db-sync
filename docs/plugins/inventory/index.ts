import path from 'node:path';

import type {LoadContext, Plugin} from '@docusaurus/types';

/** Set to `1` to serve the component inventory under `docusaurus start`. */
export const INVENTORY_ENV_VAR = 'DBS_INVENTORY';

/** Where the inventory is served, relative to `baseUrl`. */
export const INVENTORY_PATH = '__inventory';

/** B44-d feed-state fixture, subject to the same development-only gate. */
export const UPDATES_FIXTURE_PATH = '__updates';

/**
 * B29 — the component inventory route, for development and the browser suite only.
 *
 * The page is not under `src/pages`, so neither profile builds it. This plugin adds its route when
 * `DBS_INVENTORY=1`, and only to the development server: a production-mode build with the flag set
 * fails, so the inventory can never be deployed or recorded in the append-only route manifest
 * (VER-5).
 */
export function inventoryEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env[INVENTORY_ENV_VAR] !== '1') {
    return false;
  }
  if (env.NODE_ENV === 'production') {
    throw new Error(
      `${INVENTORY_ENV_VAR}=1 is for "docusaurus start" only: the component inventory must never ` +
        'be built into a deployable site or its route manifest.',
    );
  }
  return true;
}

/** Where the B34 layout fixture docs are served, relative to `baseUrl`. */
export const LAYOUT_FIXTURE_PATH = '__layout';

/**
 * B34 — a second docs instance holding fixture pages (sections, a long page with a table of
 * contents) for the responsive-layout browser suite. The real docs are one short page, which
 * exercises none of the sidebar groups, disclosures or TOC. Same gate as the inventory: the
 * development server with `DBS_INVENTORY=1` only, never a build.
 */
export function layoutFixturePlugins(
  env: NodeJS.ProcessEnv = process.env,
): [string, Record<string, unknown>][] {
  if (!inventoryEnabled(env)) {
    return [];
  }
  return [
    [
      '@docusaurus/plugin-content-docs',
      {
        id: 'layout-fixture',
        path: 'test/fixtures/layout-docs',
        routeBasePath: LAYOUT_FIXTURE_PATH,
      },
    ],
  ];
}

export default function inventoryPlugin(context: LoadContext): Plugin {
  return {
    name: 'dbs-inventory',
    async contentLoaded({actions}) {
      if (!inventoryEnabled()) {
        return;
      }
      for (const state of [
        'ready',
        'mainnet',
        'missing',
        'stale',
        'invalid',
        'network',
        'no-model',
      ]) {
        actions.addRoute({
          path: `${context.baseUrl}__numbers/${state}`,
          component: path.resolve(context.siteDir, 'src/numbers/fixtures.ts'),
          exact: true,
        });
      }
      actions.addRoute({
        path: `${context.baseUrl}${UPDATES_FIXTURE_PATH}`,
        component: path.resolve(context.siteDir, 'test/fixtures/updates/UpdatesFixture.tsx'),
        exact: true,
      });
      actions.addRoute({
        path: `${context.baseUrl}${INVENTORY_PATH}`,
        component: path.resolve(context.siteDir, 'src/inventory/InventoryPage.tsx'),
        exact: true,
      });
    },
  };
}
