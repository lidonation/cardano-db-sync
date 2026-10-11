import {describe, expect, it} from 'vitest';

import type {RenameMap} from '../../src/data/schema-renames';
import {
  RENAMES_SCHEMA_VERSION,
  currentName,
  findRenamed,
  formerNames,
  hasRun,
  loadRenames,
  nameAt,
} from '../../src/data/schema-renames';

/**
 * The rename map's access layer, against the committed artifact (B09, GDE-9). Structural validation
 * lives in `scripts/check-renames.mjs`; the scanning rules are pinned by the extractor's
 * `renames-test`.
 */
describe('schema rename map', () => {
  it('loads the committed artifact at the supported schema version', () => {
    expect(loadRenames().schemaVersion).toBe(RENAMES_SCHEMA_VERSION);
    expect(() => loadRenames({...loadRenames(), schemaVersion: 2})).toThrow(/schema version 2/);
  });

  it('resolves pool_offline_data -> off_chain_pool_data at stage_two 26', () => {
    expect(currentName('table', 'pool_offline_data')).toBe('off_chain_pool_data');
    expect(nameAt('table', 'off_chain_pool_data', {stageTwo: 25})).toBe('pool_offline_data');
    expect(nameAt('table', 'off_chain_pool_data', {stageTwo: 26})).toBe('off_chain_pool_data');
    expect(nameAt('table', 'pool_offline_data', {stageTwo: 50})).toBe('off_chain_pool_data');
  });

  it('resolves ada_pots.deposits -> deposits_stake at stage_two 34', () => {
    expect(currentName('column', 'deposits', 'ada_pots')).toBe('deposits_stake');
    expect(nameAt('column', 'deposits_stake', {stageTwo: 33}, 'ada_pots')).toBe('deposits');
    expect(nameAt('column', 'deposits_stake', {stageTwo: 34}, 'ada_pots')).toBe('deposits_stake');
    // a column is scoped by its table: another table's `deposits` is not this one
    expect(currentName('column', 'deposits', 'epoch_param')).toBe('deposits');
  });

  it('reads a renamed table as one entity, not a drop plus a create', () => {
    const entity = findRenamed('table', 'reward_rest');
    expect(entity).toEqual(findRenamed('table', 'instant_reward'));
    expect(formerNames('table', 'reward_rest')).toEqual(['instant_reward']);
    // a constraint is found through its table's former name too
    expect(currentName('constraint', 'unique_instant_reward', 'instant_reward')).toBe(
      'unique_reward_rest',
    );
  });

  it('returns a name that was never renamed unchanged', () => {
    expect(currentName('table', 'tx_out')).toBe('tx_out');
    expect(nameAt('table', 'tx_out', {stageTwo: 1})).toBe('tx_out');
    expect(formerNames('table', 'tx_out')).toEqual([]);
  });

  it('treats unversioned stages as always run and versions stage four separately', () => {
    const migration = (stage: number, version: number) => ({stage, version, file: 'f'});
    expect(hasRun(migration(3, 3), {stageTwo: 0})).toBe(true);
    expect(hasRun(migration(1, 9), {stageTwo: 0})).toBe(true);
    expect(hasRun(migration(4, 9), {stageTwo: 50, stageFour: 8})).toBe(false);
    expect(hasRun(migration(4, 9), {stageTwo: 50, stageFour: 9})).toBe(true);
    expect(hasRun(migration(4, 9), {stageTwo: 50})).toBe(true);
    expect(nameAt('index', 'idx_off_chain_pool_data_pmr_id', {stageTwo: 0})).toBe(
      'idx_off_chain_pool_data_pmr_id',
    );
  });

  it('walks a chain of renames to the name in force at each version', () => {
    const until = (version: number) => ({stage: 2, version, file: `migration-2-${version}.sql`});
    const chain: RenameMap = {
      schemaVersion: 1,
      source: 'schema',
      renames: [],
      entities: [
        {
          kind: 'table',
          name: 'gamma',
          formerNames: [
            {name: 'alpha', until: until(10)},
            {name: 'beta', until: until(20)},
          ],
        },
      ],
    };
    expect(nameAt('table', 'beta', {stageTwo: 9}, undefined, chain)).toBe('alpha');
    expect(nameAt('table', 'alpha', {stageTwo: 15}, undefined, chain)).toBe('beta');
    expect(nameAt('table', 'alpha', {stageTwo: 20}, undefined, chain)).toBe('gamma');
    expect(formerNames('table', 'gamma', undefined, chain)).toEqual(['alpha', 'beta']);
  });
});
