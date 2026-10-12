import path from 'node:path';

import type {LoadContext, Plugin} from '@docusaurus/types';

/** Set to `1` to serve the component inventory under `docusaurus start`. */
export const INVENTORY_ENV_VAR = 'DBS_INVENTORY';

/** Where the inventory is served, relative to `baseUrl`. */
export const INVENTORY_PATH = '__inventory';

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

export default function inventoryPlugin(context: LoadContext): Plugin {
  return {
    name: 'dbs-inventory',
    async contentLoaded({actions}) {
      if (!inventoryEnabled()) {
        return;
      }
      actions.addRoute({
        path: `${context.baseUrl}${INVENTORY_PATH}`,
        component: path.resolve(context.siteDir, 'src/inventory/InventoryPage.tsx'),
        exact: true,
      });
    },
  };
}
