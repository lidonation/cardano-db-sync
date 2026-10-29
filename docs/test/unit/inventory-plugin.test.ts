import path from 'node:path';

import type {LoadContext} from '@docusaurus/types';
import {afterEach, describe, expect, it, vi} from 'vitest';

import inventoryPlugin, {
  INVENTORY_ENV_VAR,
  INVENTORY_PATH,
  LAYOUT_FIXTURE_PATH,
  UPDATES_FIXTURE_PATH,
  inventoryEnabled,
  layoutFixturePlugins,
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
      ...[
        'ready',
        'mainnet',
        'missing',
        'stale',
        'invalid',
        'network',
        'no-model',
        'empty',
        'zero',
        'single',
      ].map((state) => ({
        path: `/base/__numbers/${state}`,
        component: path.resolve('/site', 'src/numbers/fixtures.ts'),
        exact: true,
      })),
      {
        path: `/base/${UPDATES_FIXTURE_PATH}`,
        component: path.resolve('/site', 'test/fixtures/updates/UpdatesFixture.tsx'),
        exact: true,
      },
      {
        path: '/base/__ecosystem-empty',
        component: path.resolve('/site', 'test/fixtures/ecosystem/EmptyFixture.tsx'),
        exact: true,
      },
      {
        path: '/base/__survey-results',
        component: path.resolve('/site', 'src/survey-results/FixturePage.tsx'),
        exact: true,
      },
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

describe('layout fixture docs (B34)', () => {
  it('are added on the development server only, behind the inventory flag', () => {
    expect(layoutFixturePlugins({})).toEqual([]);
    expect(layoutFixturePlugins({[INVENTORY_ENV_VAR]: '1', NODE_ENV: 'development'})).toEqual([
      [
        '@docusaurus/plugin-content-docs',
        expect.objectContaining({id: 'layout-fixture', routeBasePath: LAYOUT_FIXTURE_PATH}),
      ],
    ]);
    expect(() =>
      layoutFixturePlugins({[INVENTORY_ENV_VAR]: '1', NODE_ENV: 'production'}),
    ).toThrow();
  });
});
