import {describe, expect, it} from 'vitest';

import {committedNumbersState, formatNumber, formatUtc, numbersState} from '../../src/numbers/data';
import type {NumbersSnapshot} from '../../src/numbers/types';

const snapshot: NumbersSnapshot = {
  network: 'preview',
  updatedAt: '2026-10-12T00:00:00.000Z',
  nextBoundary: '2026-10-13T00:00:00.000Z',
  source: 'Synthetic provider fixture',
  blockHeight: 100,
  epoch: 50,
  transactions: 1000,
  blocksThisEpoch: 10,
  recentEpochs: [{epoch: 49, blocks: 20, transactions: 200, boundary: '2026-10-12T00:00:00.000Z'}],
  storage: {
    methodology: 'Synthetic fixture; not measured.',
    configuration: 'full',
    databaseGB: 120,
    monthlyCostUSD: 12,
    tables: [{name: 'tx_out', gigabytes: 60}],
    growth: [{epoch: 49, gigabytes: 1}],
  },
};
const asOf = '2026-10-12T12:00:00.000Z';
const state = (raw: unknown) => numbersState(raw, 'preview', asOf);

describe('Numbers snapshot boundary (NUM-1…NUM-5)', () => {
  it('keeps both production profiles unavailable until B23 publishes data', () => {
    for (const network of ['preview', 'mainnet'] as const)
      expect(committedNumbersState(network)).toEqual({status: 'unavailable', reason: 'missing'});
    expect(state(null)).toEqual({status: 'unavailable', reason: 'missing'});
    expect(state(undefined)).toEqual({status: 'unavailable', reason: 'missing'});
  });
  it('passes shared model outputs unchanged, without a second calculation', () => {
    const result = state(snapshot);
    expect(result.status).toBe('ready');
    if (result.status === 'unavailable') throw new Error('expected ready');
    expect(result.snapshot).toEqual(snapshot);
    expect(result.snapshot.storage).toEqual(snapshot.storage);
  });
  it('supports chain facts with no storage model', () => {
    const result = state({...snapshot, storage: null});
    expect(result.status).toBe('ready');
    if (result.status !== 'unavailable') expect(result.snapshot.storage).toBeNull();
  });
  it('rejects the other build network instead of displaying its numbers', () => {
    expect(numbersState(snapshot, 'mainnet', asOf)).toEqual({
      status: 'unavailable',
      reason: 'network',
    });
  });
  it('marks the data stale exactly at its network-derived next boundary', () => {
    expect(numbersState(snapshot, 'preview', '2026-10-12T23:59:59.999Z').status).toBe('ready');
    expect(numbersState(snapshot, 'preview', snapshot.nextBoundary).status).toBe('stale');
    expect(numbersState(snapshot, 'preview', '2026-11-01T00:00:00.000Z').status).toBe('stale');
    expect(
      numbersState(
        {...snapshot, network: 'mainnet', nextBoundary: '2026-10-17T00:00:00.000Z'},
        'mainnet',
        '2026-10-16T00:00:00.000Z',
      ).status,
    ).toBe('ready');
  });
  it.each([
    {},
    [],
    'x',
    0,
    true,
    {...snapshot, network: 'preprod'},
    {...snapshot, storage: {}},
    {...snapshot, storage: undefined},
    {...snapshot, updatedAt: '2026-02-30T00:00:00.000Z'},
    {...snapshot, updatedAt: '2026-10-14T00:00:00.000Z'},
    {...snapshot, nextBoundary: snapshot.updatedAt},
    {...snapshot, nextBoundary: '2026-10-14T00:00:00.000Z'},
    {...snapshot, source: ''},
    {...snapshot, source: ' '.repeat(4)},
    {...snapshot, source: 'a'.repeat(513)},
    {...snapshot, recentEpochs: {}},
    {...snapshot, recentEpochs: [...snapshot.recentEpochs, ...snapshot.recentEpochs]},
    {...snapshot, recentEpochs: [{...snapshot.recentEpochs[0], epoch: 51}]},
    {
      ...snapshot,
      recentEpochs: [{...snapshot.recentEpochs[0], boundary: '2026-10-13T00:00:00.000Z'}],
    },
    {...snapshot, storage: {...snapshot.storage, tables: [{name: 'bad table', gigabytes: 1}]}},
    {...snapshot, storage: {...snapshot.storage, tables: [{name: 'tx_out', gigabytes: 121}]}},
    {...snapshot, storage: {...snapshot.storage, methodology: ''}},
    {...snapshot, storage: {...snapshot.storage, configuration: ''}},
    {...snapshot, storage: {...snapshot.storage, growth: [{epoch: 51, gigabytes: 1}]}},
    {
      ...snapshot,
      storage: {
        ...snapshot.storage,
        growth: [
          {epoch: 49, gigabytes: 1},
          {epoch: 49, gigabytes: 2},
        ],
      },
    },
    {
      ...snapshot,
      storage: {
        ...snapshot.storage,
        tables: [
          {name: 'tx_out', gigabytes: 1},
          {name: 'tx_out', gigabytes: 2},
        ],
      },
    },
  ])('fails closed on malformed input %#', (input) => {
    expect(state(input)).toEqual({status: 'unavailable', reason: 'invalid'});
  });
  it('rejects invalid as-of timestamps', () => {
    expect(numbersState(snapshot, 'preview', 'tomorrow')).toEqual({
      status: 'unavailable',
      reason: 'invalid',
    });
  });
  it('preserves honest zero values and empty collections', () => {
    expect(
      state({
        ...snapshot,
        blockHeight: 0,
        epoch: 0,
        transactions: 0,
        blocksThisEpoch: 0,
        recentEpochs: [],
        storage: {...snapshot.storage, databaseGB: 0, monthlyCostUSD: 0, tables: [], growth: []},
      }).status,
    ).toBe('ready');
  });
  it('validates every numeric boundary with bounded deterministic mutations', () => {
    const invalid = [-1, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1, '3', null];
    for (const key of ['blockHeight', 'epoch', 'transactions', 'blocksThisEpoch']) {
      for (const value of [...invalid, 0.5])
        expect(state({...snapshot, [key]: value}).status).toBe('unavailable');
    }
    for (const key of ['databaseGB', 'monthlyCostUSD']) {
      for (const value of invalid)
        expect(state({...snapshot, storage: {...snapshot.storage, [key]: value}}).status).toBe(
          'unavailable',
        );
    }
    for (const value of invalid) {
      expect(
        state({
          ...snapshot,
          storage: {...snapshot.storage, growth: [{epoch: 49, gigabytes: value}]},
        }).status,
      ).toBe('unavailable');
      expect(
        state({
          ...snapshot,
          storage: {...snapshot.storage, tables: [{name: 'tx', gigabytes: value}]},
        }).status,
      ).toBe('unavailable');
    }
  });
  it('limits collections and accepts their documented limits', () => {
    const recentEpochs = Array.from({length: 12}, (_, i) => ({
      ...snapshot.recentEpochs[0],
      epoch: i,
    }));
    expect(state({...snapshot, recentEpochs}).status).toBe('ready');
    expect(
      state({...snapshot, recentEpochs: [...recentEpochs, {...recentEpochs[0], epoch: 12}]}).status,
    ).toBe('unavailable');
    const tables = Array.from({length: 12}, (_, i) => ({name: `table_${i}`, gigabytes: 1}));
    const growth = recentEpochs.map(({epoch}) => ({epoch, gigabytes: 1}));
    expect(state({...snapshot, storage: {...snapshot.storage, tables, growth}}).status).toBe(
      'ready',
    );
    expect(
      state({
        ...snapshot,
        storage: {...snapshot.storage, tables: [...tables, {name: 'extra', gigabytes: 1}]},
      }).status,
    ).toBe('unavailable');
    expect(
      state({
        ...snapshot,
        storage: {...snapshot.storage, growth: [...growth, {epoch: 12, gigabytes: 1}]},
      }).status,
    ).toBe('unavailable');
  });
  it('accepts decimal sums within rounding error, but not excessive table totals', () => {
    const storage = {
      ...snapshot.storage,
      databaseGB: 0.3,
      tables: [
        {name: 'tx', gigabytes: 0.1},
        {name: 'tx_out', gigabytes: 0.2},
      ],
    };
    expect(state({...snapshot, storage}).status).toBe('ready');
    expect(state({...snapshot, storage: {...storage, databaseGB: 0.299999}}).status).toBe(
      'unavailable',
    );
  });
  it('rejects unfinished epochs from completed history', () => {
    expect(
      state({...snapshot, recentEpochs: [{...snapshot.recentEpochs[0], epoch: snapshot.epoch}]})
        .status,
    ).toBe('unavailable');
  });
  it('rejects sparse collections that Array.every would skip', () => {
    expect(state({...snapshot, recentEpochs: new Array(1)}).status).toBe('unavailable');
    for (const key of ['tables', 'growth'])
      expect(state({...snapshot, storage: {...snapshot.storage, [key]: new Array(1)}}).status).toBe(
        'unavailable',
      );
  });
  it('uses stable SSR/client number and UTC date formatting', () => {
    expect(formatNumber(1234.5)).toBe('1,234.5');
    expect(formatUtc(snapshot.updatedAt)).toBe('2026-10-12 00:00 UTC');
  });
});
