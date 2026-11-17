import schema from '../../generated/config-schema.json' with {type: 'json'};
import {presetValues, validateConfig} from '../data/config-schema.mjs';
import {numbersState} from '../numbers/snapshot.mjs';
export const MODEL_LABEL = 'MODELLED ESTIMATES';
export const FULL_CONFIGURATION = {insert_options: {preset: 'full'}};
const configSchema = schema;
const object = (value) =>
  value && typeof value === 'object' && !Array.isArray(value) ? value : {};
/** Illustrative planning coefficients, not fitted measurements. All consumers use this function. */
export function modelStorage(facts, configuration = FULL_CONFIGURATION) {
  if (
    numbersState({...facts, storage: null}, facts.network, facts.updatedAt).status === 'unavailable'
  )
    throw new Error('Invalid chain facts');
  if (validateConfig(configSchema, configuration, {fragment: true}).length)
    throw new Error('Invalid storage configuration');
  const defaults = object(
    configSchema.config.keys.find((key) => key.name === 'insert_options')?.default,
  );
  const options = object(configuration.insert_options);
  const preset = typeof options.preset === 'string' ? options.preset : 'default';
  const effective = {
    ...defaults,
    ...(presetValues(configSchema, 'insert_options.preset', preset) ?? {}),
    ...Object.fromEntries(Object.entries(options).filter(([, value]) => value !== null)),
  };
  const output = object(effective.tx_out);
  const sampleBlocks = facts.recentEpochs.reduce((sum, row) => sum + row.blocks, 0);
  const sampleTransactions = facts.recentEpochs.reduce((sum, row) => sum + row.transactions, 0);
  if (
    !sampleBlocks ||
    !Number.isSafeInteger(sampleBlocks) ||
    !Number.isSafeInteger(sampleTransactions)
  )
    throw new Error('No usable completed-epoch sample');
  const rate = sampleTransactions / sampleBlocks;
  const enabled = (name) => object(effective[name]).enable === true;
  const hasOutputs = output.value !== 'disable';
  const retention = output.value === 'prune' || output.value === 'bootstrap' ? 0.1 : 1;
  // Representative relations, not a claim to cover every SQL table. Bytes include 2× index/headroom.
  function tables(blocks, transactions, epochs) {
    const allocations = [
      ['block', blocks * 512],
      ['tx', transactions * 512],
      ['tx_out', hasOutputs ? transactions * 2 * 256 * retention : 0],
      ['tx_in', hasOutputs || output.force_tx_in === true ? transactions * 2 * 128 : 0],
      ['tx_metadata', enabled('metadata') ? transactions * 256 : 0],
      ['multi_asset', enabled('multi_asset') ? transactions * 128 : 0],
      ['redeemer', enabled('plutus') ? transactions * 512 : 0],
      ['delegation', enabled('shelley') ? transactions * 64 : 0],
      ['gov_action_proposal', effective.governance === 'enable' ? transactions * 32 : 0],
      ['epoch', effective.disable_epoch === false ? epochs * 4096 : 0],
    ];
    return allocations
      .filter(([, bytes]) => bytes > 0)
      .map(([name, bytes]) => ({name, gigabytes: (bytes * 2) / 1e9}));
  }
  const allocation = tables(facts.blockHeight, facts.blockHeight * rate, facts.epoch + 1);
  const databaseGB = allocation.reduce((sum, row) => sum + row.gigabytes, 0);
  const storage = {
    methodology: `Model v1, uncalibrated: height × ${rate.toFixed(2)} sampled tx/block; assumed row bytes in storage/model.mjs, 2 outputs/tx, 2× index/headroom, 10% output retention if pruned/bootstrap. Decimal GB; 0.10 USD/GB/month storage only, not hosting. Representative tables; ignores row filters; excludes WAL, backups and ledger state. Not measured DB sizes or a provider quote.`,
    configuration: `${preset}; tx_out=${String(output.value)}; metadata=${enabled('metadata')}; multi_asset=${enabled('multi_asset')}; plutus=${enabled('plutus')}; shelley=${enabled('shelley')}; governance=${String(effective.governance)}`,
    databaseGB,
    monthlyCostUSD: databaseGB * 0.1,
    tables: allocation,
    growth: facts.recentEpochs.map((row) => ({
      epoch: row.epoch,
      gigabytes: tables(row.blocks, row.transactions, 1).reduce(
        (sum, table) => sum + table.gigabytes,
        0,
      ),
    })),
  };
  if (numbersState({...facts, storage}, facts.network, facts.updatedAt).status === 'unavailable')
    throw new Error('Storage estimate exceeds snapshot bounds');
  return storage;
}

/** Keep a saved model and a newly configured wizard from silently using different bases. */
export function storageModelMatches(snapshot) {
  try {
    if (snapshot.storage === null && !snapshot.recentEpochs.some((row) => row.blocks > 0))
      return true;
    return JSON.stringify(modelStorage(snapshot)) === JSON.stringify(snapshot.storage);
  } catch {
    return false;
  }
}
