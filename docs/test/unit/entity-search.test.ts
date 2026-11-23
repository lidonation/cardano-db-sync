import {describe, expect, it} from 'vitest';
import {
  createEntityIndex,
  searchEntities,
  tokenize,
  loadEntityIndex,
} from '../../src/search/engine';
import type {SearchEntity} from '../../src/search/entities';

export const entity = (id: string, extra: Partial<SearchEntity> = {}): SearchEntity => ({
  id,
  identifier: id,
  aliases: [],
  title: id,
  body: '',
  url: `/schema/${id}`,
  kind: 'table',
  group: 'tables',
  facets: {},
  ...extra,
});
const records = [
  entity('tx_in', {body: 'tx_out '.repeat(500)}),
  entity('tx_out', {facets: {variants: ['core'], columns: 12, indexed: true}}),
  entity('tx_out_extra'),
  entity('guide', {identifier: '', title: 'tx_out operations', kind: 'guide', group: 'guides'}),
  entity('body', {identifier: '', title: 'Background', body: 'tx_out', kind: 'doc', group: 'docs'}),
  entity('off_chain_pool_data', {aliases: ['pool_offline_data']}),
  entity('pruned'),
  entity('NetworkName', {kind: 'config', group: 'docs'}),
];
const search = (query: string, cap = 5) =>
  searchEntities(createEntityIndex(records), 'current', query, cap);

describe('entity search (SRCH-1, SRCH-2, SRCH-5)', () => {
  it('retains whole identifiers and splits snake_case, CamelCase and acronyms without stemming', () => {
    expect(tokenize('tx_out NetworkName HTTPServer')).toEqual([
      'tx_out',
      'tx',
      'out',
      'networkname',
      'network',
      'name',
      'httpserver',
      'http',
      'server',
    ]);
    expect(search('prune')[0].hits.map((h) => h.id)).toEqual(['pruned']);
    expect(search('pruned')[0].hits[0].tier).toBe(0);
    expect(search('prunedX').flatMap((g) => g.hits)).toEqual([]);
  });
  it('orders exact before prefix before title before body, independent of prose frequency', () => {
    const result = search('tx_out');
    expect(result.map((g) => g.group)).toEqual(['tables', 'guides', 'docs']);
    expect(result[0].hits.map((h) => [h.id, h.tier])).toEqual([
      ['tx_out', 0],
      ['tx_out_extra', 1],
      ['tx_in', 3],
    ]);
    expect(result[1].hits[0].tier).toBe(2);
    expect(result[2].hits[0].tier).toBe(3);
    expect(result[0].hits[0].facets).toEqual({variants: ['core'], columns: 12, indexed: true});
    expect(result[0].hits[0]).not.toHaveProperty('body');
  });
  it('finds identifier heads, aliases, multiword and CamelCase queries', () => {
    expect(search('tx_o')[0].hits[0].id).toBe('tx_out');
    expect(search('tx out')[0].hits[0].id).toBe('tx_out');
    expect(search('txOut')[0].hits[0].id).toBe('tx_out');
    expect(search('network n')[2].hits[0].id).toBe('NetworkName');
    expect(search('pool_offline_data')[0].hits[0].id).toBe('off_chain_pool_data');
    expect(search('tx_out missing').flatMap((g) => g.hits)).toEqual([]);
  });
  it('caps each group explicitly and supports show-all; rejects invalid caps', () => {
    expect(search('tx', 1)[0]).toMatchObject({total: 3, hasMore: true, hits: [expect.anything()]});
    expect(search('tx', Infinity)[0]).toMatchObject({total: 3, hasMore: false});
    expect(() => search('tx', 0)).toThrow(/cap/);
    expect(search('   ').every((g) => !g.total)).toBe(true);
  });
  it('round trips through MiniSearch with deterministic ties and detached results', () => {
    const index = createEntityIndex([
      entity('b', {identifier: 'same'}),
      entity('a', {identifier: 'same'}),
    ]);
    const loaded = loadEntityIndex(JSON.stringify(index));
    expect(searchEntities(loaded, '13.6', 'same')[0].hits.map((h) => h.id)).toEqual(['a', 'b']);
    const first = search('tx_out')[0].hits[0];
    first.facets.variants!.push('corrupted');
    expect(search('tx_out')[0].hits[0].facets.variants).toEqual(['core']);
  });
});
