import path from 'node:path';

import type {LoadContext} from '@docusaurus/types';
import {afterEach, describe, expect, it, vi} from 'vitest';

import inventoryPlugin, {
  INVENTORY_ENV_VAR,
  INVENTORY_PATH,
  inventoryEnabled,
} from '../../plugins/inventory';

const context = {baseUrl: '/base/', siteDir: '/site'} as LoadContext;

async function routes(): Promise<unknown[]> {
  const added: unknown[] = [];
  const plugin = inventoryPlugin(context);
  await plugin.contentLoaded?.({
    content: undefined,
    actions: {addRoute: (route: unknown) => added.push(route)} as never,
  });
  return added;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('component inventory route (B29, VER-5)', () => {
  it('is off unless asked for', async () => {
    expect(inventoryEnabled({})).toBe(false);
    expect(inventoryEnabled({[INVENTORY_ENV_VAR]: '0'})).toBe(false);
    vi.stubEnv(INVENTORY_ENV_VAR, '');
    expect(await routes()).toEqual([]);
  });

  it('serves the inventory on the development server when asked', async () => {
    expect(inventoryEnabled({[INVENTORY_ENV_VAR]: '1', NODE_ENV: 'development'})).toBe(true);
    vi.stubEnv(INVENTORY_ENV_VAR, '1');
    vi.stubEnv('NODE_ENV', 'development');
    expect(await routes()).toEqual([
      {
        path: `/base/${INVENTORY_PATH}`,
        component: path.resolve('/site', 'src/inventory/InventoryPage.tsx'),
        exact: true,
      },
    ]);
  });

  it('refuses a production build, so it can never ship or enter the route manifest', () => {
    expect(() => inventoryEnabled({[INVENTORY_ENV_VAR]: '1', NODE_ENV: 'production'})).toThrow(
      /docusaurus start/,
    );
  });
});
