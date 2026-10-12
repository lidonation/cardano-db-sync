import {readFileSync, readdirSync} from 'node:fs';
import path from 'node:path';

import {describe, expect, it} from 'vitest';

import {releaseFacts} from '../../src/data/release-facts';
import {SURFACES, routeExists, routePaths} from '../../src/data/surfaces';
import {LANDING_IDS} from '../../src/landing/ids';

describe('release facts (B44-a)', () => {
  it('counts the default schema and the rename map from the committed artifacts', () => {
    const facts = releaseFacts();
    expect(facts.tables).toBeGreaterThan(70);
    expect(facts.columns).toBeGreaterThan(facts.tables);
    expect(facts.migration).toMatch(/^2-\d{4}$/);
    expect(facts.renamed).toBeGreaterThan(0);
  });

  it('counts core and shared tables, never the address variant or views', () => {
    const column = {name: 'id'} as never;
    const facts = releaseFacts(
      {
        dbSchemaVersion: {stage_one: 1, stage_two: 7, stage_three: 1},
        tables: [
          {name: 'block', variant: 'all', kind: 'table', haskell: null, columns: [column, column]},
          {name: 'tx_out', variant: 'core', kind: 'table', haskell: null, columns: [column]},
          {name: 'tx_out', variant: 'address', kind: 'table', haskell: null, columns: [column]},
          {name: 'address', variant: 'address', kind: 'table', haskell: null, columns: [column]},
          {name: 'utxo_view', variant: 'all', kind: 'view', haskell: null, columns: [column]},
        ],
      },
      {entities: [{kind: 'table', name: 'a', formerNames: []}]},
    );
    expect(facts).toEqual({tables: 2, columns: 3, migration: '2-0007', renamed: 1});
  });
});

describe('surfaces', () => {
  const tree = [
    {
      path: '/base/docs',
      routes: [{path: '/base/docs/intro'}, {path: ['/base/schema/', '/base/schema/tx_out']}],
    },
    {path: '/base/'},
    {},
  ];

  it('collects every concrete path, trailing slashes trimmed', () => {
    expect([...routePaths(tree)].sort()).toEqual([
      '/base',
      '/base/docs',
      '/base/docs/intro',
      '/base/schema',
      '/base/schema/tx_out',
    ]);
  });

  it('serves a surface only when its route exists under the base URL', () => {
    const paths = routePaths(tree);
    expect(routeExists(paths, '/base/', SURFACES.docs)).toBe(true);
    expect(routeExists(paths, '/base/', SURFACES.schema)).toBe(true);
    expect(routeExists(paths, '/base/', SURFACES.numbers)).toBe(false);
    expect(routeExists(paths, '/', SURFACES.docs)).toBe(false);
    expect(routeExists(routePaths([{path: '/'}]), '/', '/')).toBe(true);
  });
});

describe('landing language marking (A11Y-18)', () => {
  it('lists exactly the string ids the landing page renders', () => {
    const dir = path.resolve(import.meta.dirname, '../../src/landing');
    const source = readdirSync(dir)
      .filter((file) => /\.tsx?$/.test(file))
      .map((file) => readFileSync(path.join(dir, file), 'utf8'))
      .join('\n');
    const used = new Set([...source.matchAll(/id: '(landing\.[^']+)'/g)].map((match) => match[1]));
    expect([...LANDING_IDS].sort()).toEqual([...used].sort());
  });
});
