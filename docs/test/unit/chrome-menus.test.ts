import {readFileSync} from 'node:fs';
import {describe, expect, it, vi} from 'vitest';

import {FOOTER_MENU, NAVBAR_MENU, SURFACES, gateMenu, routePaths} from '../../src/data/surfaces';
import type {NavbarItemConfig} from '../../src/theme/Navbar/items';

describe('chrome route gating', () => {
  const paths = routePaths([
    {
      path: [
        '/base/docs/intro/',
        '/base/docs/guides',
        '/base/docs/guides/installation',
        '/base/numbers',
        '/base/ecosystem',
      ],
    },
  ]);
  it('keeps the locked navbar order and hides unbuilt routes', () => {
    expect(NAVBAR_MENU.map((item) => item.label)).toEqual([
      'Docs',
      'Guides',
      'Schema',
      'Numbers',
      'Survey',
      'Ecosystem',
    ]);
    expect(gateMenu(NAVBAR_MENU, paths, '/base/').map((item) => item.label)).toEqual([
      'Docs',
      'Guides',
      'Numbers',
      'Ecosystem',
    ]);
  });
  it('keeps external links, but requires exact built destinations for local links', () => {
    const items = [
      {label: 'External', href: 'https://example.org'},
      {label: 'Missing', href: '/docs/install'},
      {label: 'Docs', href: SURFACES.docs},
    ];
    expect(gateMenu(items, paths, '/base/')).toEqual([items[0], items[2]]);
    expect(gateMenu(items, new Set(), '/')).toEqual([items[0]]);
  });
  it('covers every registered surface in the header or footer', () => {
    const menuPaths = new Set(
      [...NAVBAR_MENU, ...FOOTER_MENU.flatMap((column) => column.items)].map((item) => item.href),
    );
    for (const surface of Object.values(SURFACES)) {
      if (paths.has('/base' + surface)) expect(menuPaths.has(surface)).toBe(true);
    }
  });
  it('keeps the locked footer columns and route-gates their destinations', () => {
    expect(FOOTER_MENU.map((column) => column.title)).toEqual(['Docs', 'Project', 'Community']);
    expect(FOOTER_MENU[0]!.items.map((item) => item.label)).toEqual([
      'Introduction',
      'Guides',
      'Installation',
      'Configuration',
      'Schema',
    ]);
    expect(gateMenu(FOOTER_MENU[0]!.items, paths, '/base/').map((item) => item.label)).toEqual([
      'Introduction',
      'Guides',
      'Installation',
    ]);
  });
});

it('keeps Docs as a version-aware sidebar destination', () => {
  const config = readFileSync(new URL('../../docusaurus.config.ts', import.meta.url), 'utf8');
  expect(config).toContain("type: 'docSidebar'");
  expect(config).toContain("sidebarId: 'docsSidebar'");
});

it('shows the roadmap anchor only with its ecosystem page', () => {
  const roadmap = {label: 'Roadmap', href: '/ecosystem#roadmap'};
  expect(gateMenu([roadmap], new Set(['/base/ecosystem']), '/base/')).toEqual([roadmap]);
  expect(gateMenu([roadmap], new Set(), '/base/')).toEqual([]);
});

it('routes Guides and Installation to real guide pages', () => {
  expect(SURFACES.guides).toBe('/docs/guides');
  expect(SURFACES.installation).toBe('/docs/guides/installation');
});

it('keeps stock navbar dispatch limited to selectors and their links', async () => {
  const {default: path} = await import('node:path');
  const source = readFileSync(
    path.resolve(import.meta.dirname, '../../src/theme/NavbarItem/ComponentTypes.tsx'),
    'utf8',
  );
  const registered = [...source.matchAll(/^ {2}(\w+):/gm)].map((match) => match[1]);
  expect(registered.sort()).toEqual([
    'default',
    'docsVersionDropdown',
    'dropdown',
    'localeDropdown',
  ]);
  const {deriveNav} = await import('../../src/theme/Navbar/items');
  vi.stubEnv('DOCS_PROFILE', 'dev');
  let config;
  try {
    config = await import('../../docusaurus.config');
  } finally {
    vi.unstubAllEnvs();
  }
  const items = (config.default.themeConfig as {navbar: {items: NavbarItemConfig[]}}).navbar.items;
  const nav = deriveNav(items, '/', '/', {sidebarLinks: {}, docPaths: {}});
  for (const item of [...nav.actions, ...nav.preferences]) expect(registered).toContain(item.type);
});
