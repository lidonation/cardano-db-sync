import {describe, expect, it} from 'vitest';
import {modelStorage} from '../../src/storage/model.mjs';
import {wizardStorageState} from '../../src/storage/wizard';
import {numbersState} from '../../src/numbers/data';
import type {ChainFacts} from '../../src/storage/types';
import wallet from '../../src/data/config-wizard/design-wallet-utxo.json';

const facts: ChainFacts = {
  network: 'preview',
  updatedAt: '2026-11-17T00:05:00.000Z',
  nextBoundary: '2026-11-18T00:00:00.000Z',
  source: 'Blockfrost (preview)',
  blockHeight: 1_000_000,
  epoch: 1484,
  transactions: 100,
  blocksThisEpoch: 10,
  recentEpochs: [
    {epoch: 1483, blocks: 1000, transactions: 20_000, boundary: '2026-11-17T00:00:00.000Z'},
  ],
};
const full = {insert_options: {preset: 'full'}};
describe('one config-aware capacity model (NUM-1/NUM-2)', () => {
  it('gives Numbers and the wizard identical full-config values and provenance', () => {
    const storage = modelStorage(facts, full);
    const state = numbersState({...facts, storage}, 'preview', facts.updatedAt);
    const wizard = wizardStorageState(state, full);
    expect(wizard).toEqual({
      status: 'ready',
      label: 'MODELLED ESTIMATES',
      updatedAt: facts.updatedAt,
      storage,
    });
    expect(storage.methodology).toMatch(/v1.*uncalibrated/i);
    expect(storage.methodology).toMatch(/0\.10 USD\/GB\/month/);
    expect(storage.methodology).toMatch(/not.*measured/i);
    expect(storage.databaseGB).toBeGreaterThan(0);
    expect(storage.monthlyCostUSD).toBeCloseTo(storage.databaseGB * 0.1);
    expect(storage.tables.reduce((sum, row) => sum + row.gigabytes, 0)).toBeCloseTo(
      storage.databaseGB,
    );
  });
  it('uses B10 presets and actual overrides; disabling tables and pruning reduce estimates', () => {
    const all = modelStorage(facts, full);
    const disabled = modelStorage(facts, {insert_options: {preset: 'disable_all'}});
    const utxo = modelStorage(facts, wallet);
    expect(disabled.databaseGB).toBeLessThan(utxo.databaseGB);
    expect(utxo.databaseGB).toBeLessThan(all.databaseGB);
    expect(disabled.tables.map((row) => row.name)).not.toContain('tx_out');
    expect(utxo.tables.map((row) => row.name)).toContain('tx_out');
    expect(utxo.tables.map((row) => row.name)).not.toContain('tx_metadata');
    const pruned = modelStorage(facts, {
      insert_options: {preset: 'full', tx_out: {value: 'prune'}},
    });
    expect(pruned.databaseGB).toBeLessThan(all.databaseGB);
    expect(pruned.configuration).toContain('prune');
    expect(() => modelStorage(facts, {insert_options: {preset: 'invented'}})).toThrow(/config/i);
  });
  it('treats null options like the binary: use the selected preset default', () => {
    expect(
      modelStorage(facts, {insert_options: {preset: 'full', metadata: null, tx_out: null}}),
    ).toEqual(modelStorage(facts, full));
  });
  it('preserves missing and stale states rather than making the wizard look live', () => {
    expect(wizardStorageState({status: 'unavailable', reason: 'missing'}, full)).toMatchObject({
      status: 'unavailable',
    });
    const storage = modelStorage(facts, full);
    expect(
      wizardStorageState(numbersState({...facts, storage}, 'preview', facts.nextBoundary), full),
    ).toMatchObject({status: 'stale', updatedAt: facts.updatedAt, storage});
    expect(
      wizardStorageState(numbersState({...facts, storage}, 'preview', facts.updatedAt), {
        insert_options: {preset: 'oops'},
      }),
    ).toMatchObject({status: 'unavailable'});
  });
  it('does not show a differently versioned model in the wizard while Numbers retains the old one', () => {
    const storage = {...modelStorage(facts, full), methodology: 'Older model basis'};
    expect(
      wizardStorageState(numbersState({...facts, storage}, 'preview', facts.updatedAt), full),
    ).toMatchObject({status: 'unavailable'});
  });
  it('does not invent lifetime transaction volume without a usable history sample', () => {
    expect(() => modelStorage({...facts, recentEpochs: []}, full)).toThrow(/sample/i);
    expect(() =>
      modelStorage({...facts, recentEpochs: [{...facts.recentEpochs[0], blocks: 0}]}, full),
    ).toThrow(/sample/i);
  });
  it('rejects invalid facts and estimates beyond numeric snapshot bounds', () => {
    expect(() => modelStorage({...facts, blockHeight: -1}, full)).toThrow(/chain facts/i);
    expect(() =>
      modelStorage(
        {
          ...facts,
          blockHeight: Number.MAX_SAFE_INTEGER,
          recentEpochs: [
            {...facts.recentEpochs[0], blocks: 1, transactions: Number.MAX_SAFE_INTEGER},
          ],
        },
        full,
      ),
    ).toThrow(/bounds/i);
    expect(modelStorage(facts, {}).databaseGB).toBeGreaterThan(0);
  });
  it('has deterministic, finite, nonnegative outputs for bounded volume mutations', () => {
    for (let scale = 0; scale < 50; scale++) {
      const data = {...facts, blockHeight: scale * 10_000};
      const a = modelStorage(data, full);
      expect(modelStorage(data, full)).toEqual(a);
      expect(Number.isFinite(a.databaseGB)).toBe(true);
      expect(a.databaseGB).toBeGreaterThanOrEqual(0);
      expect(a.growth).toHaveLength(1);
      expect(a.growth[0].gigabytes).toBeGreaterThan(0);
    }
  });
});
