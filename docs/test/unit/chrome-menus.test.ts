import {readFileSync} from 'node:fs';
import {describe, expect, it} from 'vitest';

import {FOOTER_MENU, NAVBAR_MENU, SURFACES, gateMenu, routePaths} from '../../src/data/surfaces';

describe('chrome route gating', () => {
  const paths = routePaths([{path: ['/base/docs/intro/', '/base/numbers', '/base/ecosystem']}]);
  it('keeps the locked navbar order and hides unbuilt routes', () => {
    expect(NAVBAR_MENU.map((item) => item.label)).toEqual([
      'Docs',
      'Schema',
      'Numbers',
      'Survey',
      'Ecosystem',
    ]);
    expect(gateMenu(NAVBAR_MENU, paths, '/base/').map((item) => item.label)).toEqual([
      'Docs',
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
      'Installation',
      'Configuration',
      'Schema',
    ]);
    expect(gateMenu(FOOTER_MENU[0]!.items, paths, '/base/').map((item) => item.label)).toEqual([
      'Introduction',
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
