import {describe, expect, it} from 'vitest';
import type {PropSidebarItem} from '@docusaurus/plugin-content-docs';

import {currentSection} from '../../src/theme/DocLayout/sections';
import {deriveNav, isUnder, type DocsState} from '../../src/theme/Navbar/items';

const DOCS: DocsState = {
  sidebarLinks: {docsSidebar: '/cardano-db-sync/docs/intro', guides: undefined},
  docPaths: {schema: '/cardano-db-sync/docs/schema'},
};

describe('isUnder', () => {
  it('matches the path itself and anything below it, not a sibling prefix', () => {
    expect(isUnder('/docs', '/docs')).toBe(true);
    expect(isUnder('/docs/', '/docs')).toBe(true);
    expect(isUnder('/docs/intro', '/docs/')).toBe(true);
    expect(isUnder('/docs-old/intro', '/docs')).toBe(false);
  });
});

describe('deriveNav (NAV-1)', () => {
  const items = [
    {type: 'docSidebar', sidebarId: 'docsSidebar', label: 'Docs'},
    {type: 'docSidebar', sidebarId: 'guides', label: 'Guides'},
    {type: 'docSidebar', label: 'No sidebar id'},
    {type: 'doc', docId: 'schema', label: 'Schema'},
    {type: 'doc', docId: 'missing', label: 'Missing'},
    {type: 'doc', label: 'No doc id'},
    {to: '/survey', label: 'Survey'},
    {to: 'numbers', label: 'Numbers', activeBasePath: '/numbers/'},
    {type: 'localeDropdown'},
    {type: 'docsVersionDropdown'},
    {href: 'https://github.com/IntersectMBO/cardano-db-sync', label: 'GitHub'},
    {href: 'https://example.org', label: 'Second href'},
    {label: 'Neither to nor href'},
  ];

  it('derives links from the config, skipping sidebars and docs with no page', () => {
    const nav = deriveNav(items, '/cardano-db-sync/', '/cardano-db-sync/', DOCS);
    expect(nav.links.map((link) => [link.label, link.href])).toEqual([
      ['Docs', '/cardano-db-sync/docs/intro'],
      ['Schema', '/cardano-db-sync/docs/schema'],
      ['Survey', '/survey'],
      ['Numbers', 'numbers'],
    ]);
    expect(nav.links.every((link) => !link.active)).toBe(true);
    expect(nav.github).toBe('https://github.com/IntersectMBO/cardano-db-sync');
    expect(nav.preferences.map((item) => item.type)).toEqual([
      'localeDropdown',
      'docsVersionDropdown',
    ]);
  });

  it('marks a sidebar section active for any doc in that sidebar, with no slug list', () => {
    const nav = deriveNav(items, '/cardano-db-sync/docs/added-later', '/cardano-db-sync/', {
      ...DOCS,
      activeSidebar: 'docsSidebar',
      activeDocId: 'added-later',
    });
    expect(nav.links.filter((link) => link.active).map((link) => link.label)).toEqual(['Docs']);
  });

  it('marks a doc item active on that doc', () => {
    const nav = deriveNav(items, '/cardano-db-sync/docs/schema', '/cardano-db-sync/', {
      ...DOCS,
      activeDocId: 'schema',
    });
    expect(nav.links.filter((link) => link.active).map((link) => link.label)).toEqual(['Schema']);
  });

  it('marks a page link active under its path or its activeBasePath', () => {
    const active = (pathname: string) =>
      deriveNav(items, pathname, '/cardano-db-sync/', DOCS)
        .links.filter((link) => link.active)
        .map((link) => link.label);
    expect(active('/cardano-db-sync/survey/step-2')).toEqual(['Survey']);
    expect(active('/cardano-db-sync/numbers/mainnet')).toEqual(['Numbers']);
    expect(active('/cardano-db-sync/surveyed')).toEqual([]);
  });
});

describe('deriveNav labels', () => {
  it('renders an unlabelled item with an empty label rather than dropping it', () => {
    const nav = deriveNav(
      [{type: 'docSidebar', sidebarId: 'docsSidebar'}, {type: 'doc', docId: 'schema'}, {to: '/x'}],
      '/',
      '/',
      DOCS,
    );
    expect(nav.links.map((link) => link.label)).toEqual(['', '', '']);
  });
});

describe('currentSection', () => {
  const link = (label: string): PropSidebarItem => ({type: 'link', label, href: `/${label}`});
  const category = (label: string, items: PropSidebarItem[]): PropSidebarItem => ({
    type: 'category',
    label,
    items,
    collapsed: false,
    collapsible: true,
  });
  const sidebar = [
    link('intro'),
    category('getting started', [link('install')]),
    category('operations', [link('tuning')]),
  ];
  const activeOn =
    (href: string) =>
    (item: PropSidebarItem): boolean =>
      item.type === 'link'
        ? item.href === href
        : item.type === 'category' && item.items.some(activeOn(href));

  it('is the top-level category holding the current page', () => {
    expect(currentSection(sidebar, activeOn('/tuning'))).toEqual({
      label: 'operations',
      items: [link('tuning')],
    });
  });

  it('is the whole sidebar when the page is under no category', () => {
    expect(currentSection(sidebar, activeOn('/intro'))).toEqual({label: null, items: sidebar});
  });
});
