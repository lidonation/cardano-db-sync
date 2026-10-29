import {describe, expect, it} from 'vitest';
import {catalogToTables, configKeys} from '../../scripts/lib/guide-history.mjs';

describe('historical guide dependencies', () => {
  it('reads tables and fingerprinted columns from each real catalog variant', () => {
    const catalog = {
      types: new Map(),
      tables: new Map([
        [
          'demo',
          [
            {
              name: 'id',
              format: 'integer',
              type_oid: 23,
              not_null: true,
              default: null,
              kind: 'table',
            },
          ],
        ],
      ]),
    };
    const actual = catalogToTables(catalog, 'core');
    expect(actual[0].name).toBe('demo');
    expect(actual[0].variant).toBe('core');
    expect(actual[0].columns[0].fingerprint).toMatch(/^sha256:/);
    expect(actual[0].columns[0].nullable).toBe(false);
  });
  it('flattens nested parsed config keys without inventing aliases', () => {
    const artifact = {
      config: {
        keys: [
          {
            name: 'insert_options',
            shape: {
              keys: [{name: 'tx_out', shape: {keys: [{name: 'value', shape: {type: 'string'}}]}}],
            },
          },
        ],
      },
    };
    expect(configKeys(artifact)).toEqual([
      'insert_options',
      'insert_options.tx_out',
      'insert_options.tx_out.value',
    ]);
  });
});

it('keeps every release in declared order and refuses missing history', async () => {
  const {buildHistory} = await import('../../scripts/lib/guide-history.mjs');
  const releases = [
    {tag: 'a', stage_two: '0041', stage_four: '0008'},
    {tag: 'b', stage_two: '0042', stage_four: '0008'},
  ];
  const actual = buildHistory(releases, (entry: {tag: string}) => ({
    schema: {tables: []},
    config: {config: {keys: []}},
    tag: entry.tag,
  }));
  expect(actual.versions.map((x: {tag: string}) => x.tag)).toEqual(['a', 'b']);
  expect(() => buildHistory(releases, () => null)).toThrow();
});

it('replays the 13.7.2.0 upgrade before the epoch table becomes a view', async () => {
  const {historyReplayPlan} = await import('../../scripts/lib/guide-history.mjs');
  const files = [
    {name: 'old', stage: 2, version: 48},
    {name: 'new', stage: 2, version: 49},
    {name: 'index', stage: 4, version: 5},
  ];
  expect(
    historyReplayPlan(files, '13.7.2.0').map((step: {files: {name: string}[]}) =>
      step.files.map((f) => f.name),
    ),
  ).toEqual([['old'], ['index'], ['new']]);
  expect(
    historyReplayPlan(files, '13.7.2.1').map((step: {files: {name: string}[]}) =>
      step.files.map((f) => f.name),
    ),
  ).toEqual([['old', 'new'], ['index']]);
});

it('deduplicates release contracts while detecting tampered snapshots', async () => {
  const {packHistory, unpackHistory} = await import('../../scripts/lib/guide-history.mjs');
  const s = {tables: []};
  const c = {config: {keys: []}};
  const source = {
    schemaVersion: 1,
    versions: [
      {tag: 'v1', schema: s, config: c},
      {tag: 'v2', schema: s, config: c},
    ],
  };
  const packed = packHistory(source);
  expect(Object.keys(packed.schemas)).toHaveLength(1);
  expect(Object.keys(packed.configs)).toHaveLength(1);
  expect(unpackHistory(packed)).toEqual(source.versions);
  packed.schemas[Object.keys(packed.schemas)[0]].tables.push({name: 'tampered'});
  expect(() => unpackHistory(packed)).toThrow('digest');
});

it('rejects incomplete parsed historical config data', async () => {
  const {packHistory, unpackHistory} = await import('../../scripts/lib/guide-history.mjs');
  const packed = packHistory({
    versions: [
      {tag: 'v1', schema: {tables: []}, config: {config: {keys: []}, unresolved: ['unknown']}},
    ],
  });
  expect(() => unpackHistory(packed)).toThrow('unresolved');
});

it('rejects release tags and stage values that are not canonical numeric identifiers', async () => {
  const {validRelease} = await import('../../scripts/lib/guide-history.mjs');
  expect(validRelease({tag: '13.7.2.1', stage_two: '0050', stage_four: '0009'})).toBe(true);
  expect(validRelease({tag: '--output=/tmp/file', stage_two: '0050', stage_four: '0009'})).toBe(
    false,
  );
  expect(validRelease({tag: '13.7.2.1', stage_two: '50', stage_four: '0009'})).toBe(false);
});
