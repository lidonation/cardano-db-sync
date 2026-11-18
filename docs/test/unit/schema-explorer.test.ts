import {load} from 'cheerio';
import {describe, expect, it} from 'vitest';
import schema from '../../generated/schema.json';
import renames from '../../generated/schema-renames.json';
import history from '../../generated/schema-explorer.json';
import locks from '../../generated/guide-locks.json';
import {buildDocuments, entityIndex, tablePath} from '../../plugins/schema-explorer/model';
import type {ExplorerHistory} from '../../src/schema/types';
import type {SchemaArtifact} from '../../src/data/schema';
const input = {
  schema: schema as SchemaArtifact,
  renames: renames as import('../../src/data/schema-renames').RenameMap,
  history: history as ExplorerHistory,
};
const docs = () => buildDocuments(input, locks, '/cardano-db-sync/');
describe('B18 generated surfaces', () => {
  it('covers every variant and column with unique routes, anchors and semantic tables', () => {
    const pages = docs();
    for (const table of schema.tables) {
      const path = tablePath(table.name, table.variant);
      const $ = load(pages[path].html);
      expect($('h1')).toHaveLength(1);
      expect($('table caption').length).toBeGreaterThan(0);
      expect($('th:not([scope])')).toHaveLength(0);
      for (const column of table.columns)
        expect($(`[id="column-${column.name}"]`), path).toHaveLength(1);
      expect(pages[path].html).toContain('(0052, 0009)');
    }
    const index = entityIndex(input);
    expect(new Set(index.map((e) => e.path)).size).toBe(index.length);
    expect(
      index.find((e) => e.kind === 'table' && e.aliases.includes('pool_offline_data'))?.path,
    ).toBe('/schema/off_chain_pool_data');
    expect(
      index.find((e) => e.name === 'deposits_stake' && e.kind === 'column')?.aliases,
    ).toContain('deposits');
  });
  it('shows rename continuity, actual constraint history and current fingerprint evidence', () => {
    const pages = docs();
    expect(pages['/schema/off_chain_pool_data'].html).toContain('pool_offline_data');
    expect(pages['/schema/ada_pots'].html).toContain('deposits');
    expect(pages['/schema/ada_pots'].html).toContain('CHECK constraints changed');
    expect(pages['/schema'].html).toContain('13.7.2.1');
    expect(pages['/schema'].html).toContain('(0050, 0009)');
    expect(pages['/schema/ada_pots'].html).toContain('/schema#release-boundaries');
    for (const table of schema.tables)
      for (const column of table.columns) {
        const variant = table.variant === 'all' ? 'core' : table.variant;
        const events =
          history.changes[
            `${variant}:${table.name}.${column.name}` as keyof typeof history.changes
          ];
        expect(events?.at(-1)?.after?.fingerprint, `${variant}:${table.name}.${column.name}`).toBe(
          column.fingerprint,
        );
      }
  });
  it('gives every diagram a name, description, dimensions and equivalent relationship table', () => {
    const $ = load(docs()['/schema'].html);
    expect($('svg[role="img"]')).toHaveLength(2);
    for (const svg of $('svg').toArray()) {
      expect($(svg).attr('width')).toBeTruthy();
      expect($(svg).attr('height')).toBeTruthy();
      for (const id of $(svg).attr('aria-labelledby')!.split(' '))
        expect($(`[id="${id}"]`).text()).not.toBe('');
    }
    expect($('table[data-relationships] tbody tr').length).toBe(history.relationships.length);
    expect($('script, [style], image')).toHaveLength(0);
  });
  it('derives inverse guide links from locks and emits no unsupported current-variant guide', () => {
    const pages = docs();
    expect(pages['/schema/schema_version'].html).toContain(
      '/cardano-db-sync/docs/guides/schema-management',
    );
    expect(pages['/schema/tx_out'].html).not.toContain('/docs/guides/database-encode-decode');
    expect(pages['/schema/address/tx_out'].html).toContain('/docs/guides/database-encode-decode');
    const parsed = Object.fromEntries(
      Object.entries(pages).map(([route, page]) => [route, load(page.html)]),
    );
    for (const $ of Object.values(parsed)) {
      for (const link of $('a[href]').toArray()) {
        const href = $(link).attr('href')!;
        if (!href.startsWith('/cardano-db-sync/schema')) continue;
        const [route, anchor] = href.slice('/cardano-db-sync'.length).split('#');
        expect(pages[route], href).toBeDefined();
        if (anchor) expect(parsed[route](`[id="${anchor}"]`), href).toHaveLength(1);
      }
    }
  });
});

it('rejects stale boundary, forged current fingerprint and invalid relationship endpoints', () => {
  expect(() =>
    buildDocuments(
      {...input, history: {...input.history, current: {stageTwo: 0, stageFour: 0}}},
      locks,
      '/',
    ),
  ).toThrow(/stale/);
  expect(() =>
    buildDocuments(
      {
        ...input,
        history: {
          ...input.history,
          relationships: [
            {
              kind: 'typed-key',
              table: 'tx',
              target: 'missing',
              columns: ['id'],
              targetColumns: ['id'],
              variant: 'core',
            },
          ],
        },
      },
      locks,
      '/',
    ),
  ).toThrow(/Invalid schema relationship/);
  const changes = {...input.history.changes, 'core:ada_pots.deposits_stake': []};
  expect(() =>
    buildDocuments({...input, history: {...input.history, changes}}, locks, '/'),
  ).toThrow(/Stale column history/);
});
