import {describe, expect, it} from 'vitest';
import {columnChanges} from '../../scripts/lib/schema-explorer.mjs';
import {fingerprint} from '../../scripts/lib/schema-model.mjs';
const col = (name: string, nullable = false, checks: object[] = []) => {
  const value = {
    name,
    type: 'lovelace',
    resolved_type: {base: 'numeric(20,0)', domains: ['lovelace'], checks, not_null: false},
    nullable,
    default: null,
  };
  return {...value, fingerprint: fingerprint(value)};
};
const snapshot = (columns: object[], name = 'ada_pots') => [{name, columns}];
const renames = {
  entities: [
    {kind: 'column', table: 'ada_pots', name: 'deposits_stake', formerNames: [{name: 'deposits'}]},
    {kind: 'table', name: 'off_chain_pool_data', formerNames: [{name: 'pool_offline_data'}]},
  ],
};
describe('B18 fingerprint history', () => {
  it('keeps both known renames as changes, not unrelated add/drop pairs', () => {
    expect(
      columnChanges(snapshot([col('deposits')]), snapshot([col('deposits_stake')]), renames),
    ).toMatchObject([
      {
        table: 'ada_pots',
        column: 'deposits_stake',
        before: {name: 'deposits'},
        after: {name: 'deposits_stake'},
      },
    ]);
    expect(
      columnChanges(
        snapshot([col('id')], 'pool_offline_data'),
        snapshot([col('id')], 'off_chain_pool_data'),
        renames,
      ),
    ).toEqual([]);
  });
  it('captures adds, drops, NULL flips and transitive domain CHECK changes without unchanged noise', () => {
    const before = snapshot([
      col('id'),
      col('nullable'),
      col('removed'),
      col('value', false, [{domain: 'lovelace', definition: 'CHECK (VALUE >= 0)'}]),
    ]);
    const after = snapshot([col('id'), col('nullable', true), col('added'), col('value')]);
    const changes = columnChanges(before, after, renames);
    expect(changes.map((x: {column: string}) => x.column)).toEqual([
      'added',
      'nullable',
      'removed',
      'value',
    ]);
    expect(changes.find((x: {column: string}) => x.column === 'removed')).toMatchObject({
      after: null,
    });
  });
  it('fails on alias collisions instead of silently losing a column', () => {
    expect(() =>
      columnChanges([], snapshot([col('deposits'), col('deposits_stake')]), renames),
    ).toThrow(/collision/);
  });
});
