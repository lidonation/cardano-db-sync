import fs from 'node:fs';
import path from 'node:path';
import {describe, expect, it} from 'vitest';

const artifact = JSON.parse(
  fs.readFileSync(
    path.resolve(import.meta.dirname, '../../generated/haddock-annotations.json'),
    'utf8',
  ),
);

describe('command-line reference annotations', () => {
  it.each([
    ['pConfigFile', '--config', 'config file'],
    ['pSocketPath', '--socket-path', 'cardano-node socket'],
    ['pLedgerStateDir', '--state-dir', 'persisting ledger state'],
    ['pMigrationDir', '--schema-dir', 'migrations'],
    ['pPGPassSource', '--pg-pass-env', 'PGPASSFILE'],
    ['pForceIndexes', '--force-indexes', 'start'],
    ['pHasCache', '--disable-cache', 'memory'],
    ['pRollbackSlotNo', '--rollback-to-slot', 'next greater slot'],
    ['pHasInOut', '--disable-in-out', 'tx_in'],
    ['pAllowPrivateOffChainUrls', '--allow-private-offchain-urls', 'private'],
  ])('%s exposes %s in the extracted reference', (name, option, fact) => {
    const module = artifact.files.find(
      (file: {path: string}) => file.path === 'cardano-db-sync/app/cardano-db-sync.hs',
    );
    const annotation = module?.annotations.find((entry: {name: string}) => entry.name === name);
    expect(annotation?.doc).toContain(option);
    expect(annotation?.doc).toContain(fact);
  });
});

describe('command-line coverage', () => {
  it('mentions every long option implemented by the db-sync CLI', () => {
    const source = fs.readFileSync(
      path.resolve(import.meta.dirname, '../../../cardano-db-sync/app/cardano-db-sync.hs'),
      'utf8',
    );
    const options = [...source.matchAll(/Opt\.long "([^"]+)"/g)].map((match) => match[1]);
    const module = artifact.files.find(
      (file: {path: string}) => file.path === 'cardano-db-sync/app/cardano-db-sync.hs',
    );
    const docs = module.annotations.map((entry: {doc: string}) => entry.doc).join(' ');
    expect(options.length).toBeGreaterThanOrEqual(12);
    for (const option of options) expect(docs, option).toContain(`--${option}`);
  });
});

describe('schema reference annotations', () => {
  it.each([
    ['Block', 'block', 'blockSlotLeaderId', 'creator'],
    ['PoolHash', 'pool_hash', 'poolHashView', 'Bech32'],
    ['Tx', 'tx', 'txBlockIndex', 'zero based'],
    ['GovActionProposal', 'gov_action_proposal', 'govActionProposalVotingAnchorId', 'Anchor'],
    ['TxOutCore', 'tx_out', 'txOutCorePaymentCred', 'credential'],
    ['TxOutAddress', 'tx_out', 'txOutAddressAddressId', 'Address'],
    ['DelistedPool', 'delisted_pool', 'delistedPoolHashRaw', 'pool hash'],
    ['Script', 'script', 'scriptType', 'plutusV3'],
  ])('%s records the %s schema reference and its field', (name, table, field, fact) => {
    const annotation = artifact.files
      .flatMap((file: {annotations: {name: string; doc: string}[]}) => file.annotations)
      .find((entry: {name: string}) => entry.name === name);
    expect(annotation?.doc).toContain(table);
    const fields = annotation?.constructors?.flatMap(
      (ctor: {fields: {name: string; doc: string}[]}) => ctor.fields,
    );
    expect(fields?.find((entry: {name: string}) => entry.name === field)?.doc).toContain(fact);
  });
});

describe('configuration reference annotations', () => {
  it.each([
    ['SyncInsertConfig', 'preset', 'override'],
    ['TxOutConfig', 'tx_out', 'bootstrap'],
    ['LedgerInsertConfig', 'ledger', 'ignore'],
    ['ShelleyInsertConfig', 'stake_addresses', 'enable'],
    ['MultiAssetConfig', 'policies', 'multi_asset'],
    ['MetadataConfig', 'keys', 'metadata'],
    ['PlutusConfig', 'script_hashes', 'plutus'],
    ['OffchainPoolDataConfig', 'offchain_pool_data', 'disable'],
    ['OffchainVoteDataConfig', 'offchain_vote_data', 'disable'],
    ['SnapshotIntervalConfig', 'snapshot_interval', 'near_tip_epoch'],
  ])('%s records %s', (name, key, fact) => {
    const module = artifact.files.find(
      (file: {path: string}) => file.path === 'cardano-db-sync/src/Cardano/DbSync/Config/Types.hs',
    );
    const annotation = module?.annotations.find((entry: {name: string}) => entry.name === name);
    expect(annotation?.doc).toContain(key);
    expect(annotation?.doc).toContain(fact);
  });
});

describe('bootstrap compatibility', () => {
  it('documents supported eras and the LSM restriction', () => {
    const module = artifact.files.find(
      (file: {path: string}) => file.path === 'cardano-db-sync/src/Cardano/DbSync/Config/Types.hs',
    );
    const doc =
      module?.annotations.find((entry: {name: string}) => entry.name === 'TxOutConfig')?.doc ?? '';
    expect(doc).toContain('Dijkstra');
    expect(doc).toContain('LSM backend is not supported');
  });
});

describe('SMASH and off-chain reference annotations', () => {
  it.each([
    ['cardano-db-sync/app/http-get-json-metadata.hs', 'main', 'drep', 'local file'],
    ['cardano-db-sync/app/test-http-get-json-metadata.hs', 'main', 'PGPASSFILE', 'errors'],
    [
      'cardano-smash-server/src/Cardano/SMASH/Server/Api.hs',
      'OffChainPoolMetadataAPI',
      '/api/v1/metadata',
      'hash',
    ],
    [
      'cardano-smash-server/src/Cardano/SMASH/Server/Api.hs',
      'DelistedPoolsAPI',
      'delisted',
      'pools',
    ],
    [
      'cardano-db-sync/src/Cardano/DbSync/OffChain/Http.hs',
      'httpGetOffChainPoolData',
      '512',
      'hash',
    ],
    [
      'cardano-db-sync/src/Cardano/DbSync/OffChain/Http.hs',
      'httpGetBytes',
      'content-type',
      'text/html',
    ],
    [
      'cardano-db-sync/src/Cardano/DbSync/OffChain/Http.hs',
      'httpGetOffChainVoteData',
      'ipfs',
      'gateway',
    ],
    [
      'cardano-db-sync/src/Cardano/DbSync/OffChain/FetchQueue.hs',
      'retryAgain',
      '24 hours',
      'retry',
    ],
  ])('%s: %s describes %s', (path, name, fact, other) => {
    const module = artifact.files.find((file: {path: string}) => file.path === path);
    const annotation = module?.annotations.find((entry: {name: string}) => entry.name === name);
    expect(annotation?.doc).toContain(fact);
    expect(annotation?.doc).toContain(other);
  });
});

describe('off-chain content-type reference', () => {
  it('lists the accepted content types in the extracted annotation', () => {
    const module = artifact.files.find(
      (file: {path: string}) => file.path === 'cardano-db-sync/src/Cardano/DbSync/OffChain/Http.hs',
    );
    const doc =
      module?.annotations.find((entry: {name: string}) => entry.name === 'httpGetBytes')?.doc ?? '';
    const vote =
      module?.annotations.find((entry: {name: string}) => entry.name === 'httpGetOffChainVoteData')
        ?.doc ?? '';
    expect(vote).toContain('https://ipfs.io/ipfs');
    for (const type of [
      'application/json',
      'application/ld+json',
      'text/plain',
      'application/octet-stream',
      'binary/octet-stream',
      'application/binary',
      'text/html',
    ]) {
      expect(doc, type).toContain(type);
    }
  });
});

describe('schema reference coverage', () => {
  it('extracts the documented records and their fields independently of the legacy doc tree', () => {
    const schema = JSON.parse(
      fs.readFileSync(path.resolve(import.meta.dirname, '../../generated/schema.json'), 'utf8'),
    );
    let tables = 0;
    let fields = 0;
    for (const table of schema.tables) {
      if (!table.haskell) continue;
      const module = artifact.files.find(
        (entry: {path: string}) => entry.path === table.haskell.file,
      );
      const annotation = module?.annotations.find(
        (entry: {name: string}) => entry.name === table.haskell.record,
      );
      if (!annotation?.doc?.includes(`Schema reference for @${table.name}@`)) continue;
      tables++;
      for (const column of table.columns) {
        if (!column.haskell?.field) continue;
        const field = annotation.constructors
          ?.flatMap((ctor: {fields: {name: string; doc: string}[]}) => ctor.fields)
          .find((entry: {name: string}) => entry.name === column.haskell.field);
        if (field?.doc) fields++;
      }
    }
    // Count both output variants separately; SQL-only epoch objects are checked below.
    expect(tables).toBeGreaterThanOrEqual(78);
    expect(fields).toBeGreaterThanOrEqual(466);
  });

  it.each([
    ['queryEpochEntryStmt', 'epoch_current'],
    ['appendEpochFinalizedStmt', 'epoch_finalized'],
    ['setEpochSyncEnabledStmt', 'epoch_sync_enabled'],
  ])('documents SQL-backed %s', (declaration, table) => {
    const module = artifact.files.find(
      (file: {path: string}) =>
        file.path === 'cardano-db/src/Cardano/Db/Statement/EpochAndProtocol.hs',
    );
    const annotation = module?.annotations.find(
      (entry: {name: string}) => entry.name === declaration,
    );
    expect(annotation?.doc).toContain(`Schema reference for @${table}@`);
  });
});

describe('configuration key coverage', () => {
  it('mentions every extracted insertion option', () => {
    const schema = JSON.parse(
      fs.readFileSync(
        path.resolve(import.meta.dirname, '../../generated/config-schema.json'),
        'utf8',
      ),
    );
    const insert = schema.config.keys.find((key: {name: string}) => key.name === 'insert_options');
    const module = artifact.files.find(
      (file: {path: string}) => file.path === 'cardano-db-sync/src/Cardano/DbSync/Config/Types.hs',
    );
    const docs = module.annotations.map((entry: {doc: string}) => entry.doc).join(' ');
    for (const key of insert.shape.keys) expect(docs, key.name).toContain(key.name);
  });
});

describe('legacy-reference corrections', () => {
  const lookup = (path: string, name: string): string =>
    artifact.files
      .find((file: {path: string}) => file.path === path)
      ?.annotations.find((entry: {name: string}) => entry.name === name)?.doc ?? '';

  it('distinguishes removed CLI switches from supported options', () => {
    const doc = lookup('cardano-db-sync/app/cardano-db-sync.hs', 'pCommandLine');
    expect(doc).toContain('--skip-fix');
    expect(doc).toContain('neither is accepted');
  });
  it('describes explicit config keys overriding the chosen preset', () => {
    expect(
      lookup('cardano-db-sync/src/Cardano/DbSync/Config/Types.hs', 'SyncInsertConfig'),
    ).toContain('override');
  });
  it('does not restore the removed reward IDs', () => {
    const doc = lookup('cardano-db/src/Cardano/Db/Schema/Core/StakeDelegation.hs', 'Reward');
    expect(doc).not.toContain('@id@:');
  });
  it('documents the actual first retry interval', () => {
    expect(
      lookup('cardano-db-sync/src/Cardano/DbSync/OffChain/FetchQueue.hs', 'retryAgain'),
    ).toContain('150 seconds');
  });
});

describe('configuration source locations', () => {
  it('records the current FromJSON instance lines after documentation changes', () => {
    const source = fs.readFileSync(
      path.resolve(
        import.meta.dirname,
        '../../../cardano-db-sync/src/Cardano/DbSync/Config/Types.hs',
      ),
      'utf8',
    );
    const schema = JSON.parse(
      fs.readFileSync(
        path.resolve(import.meta.dirname, '../../generated/config-schema.json'),
        'utf8',
      ),
    );
    const lines = source.split('\n');
    const objects: {haskell: string; line: number}[] = [];
    const collect = (value: unknown): void => {
      if (!value || typeof value !== 'object') return;
      if (Array.isArray(value)) return value.forEach(collect);
      const entry = value as Record<string, unknown>;
      if (typeof entry.haskell === 'string' && typeof entry.line === 'number') {
        objects.push({haskell: entry.haskell, line: entry.line});
      }
      Object.values(entry).forEach(collect);
    };
    collect(schema.config);
    expect(objects.length).toBeGreaterThanOrEqual(8);
    for (const entry of objects) {
      expect(lines[entry.line - 1].trimStart(), entry.haskell).toMatch(/^parseJSON\b/);
      const instance = lines
        .slice(0, entry.line - 1)
        .reverse()
        .find((line) => line.startsWith('instance '));
      expect(instance, entry.haskell).toBe(`instance FromJSON ${entry.haskell} where`);
    }
  });
});

// Pin meanings, not just annotation counts: the two output variants order fields differently.
describe('reference semantics', () => {
  const annotation = (file: string, name: string) =>
    artifact.files
      .find((entry: {path: string}) => entry.path === file)
      ?.annotations.find((entry: {name: string}) => entry.name === name);
  it.each([
    ['TxOutCore', 'MaTxOutCore', 'maTxOutCoreIdent', 'MultiAsset table index'],
    ['TxOutCore', 'MaTxOutCore', 'maTxOutCoreQuantity', 'amount'],
    ['TxOutCore', 'MaTxOutCore', 'maTxOutCoreTxOutId', 'TxOut table index'],
    ['TxOutAddress', 'MaTxOutAddress', 'maTxOutAddressIdent', 'MultiAsset table index'],
    ['TxOutAddress', 'MaTxOutAddress', 'maTxOutAddressQuantity', 'amount'],
    ['TxOutAddress', 'MaTxOutAddress', 'maTxOutAddressTxOutId', 'TxOut table index'],
    ['Core/Pool', 'PoolUpdate', 'poolUpdateFixedCost', 'Lovelace'],
  ])('%s.%s.%s keeps its actual field meaning', (module, record, name, meaning) => {
    const entry = annotation(
      `cardano-db/src/Cardano/Db/Schema/${module.startsWith('Core/') ? module : `Variants/${module}`}.hs`,
      record,
    );
    const doc = entry?.constructors
      .flatMap((ctor: {fields: {name: string; doc: string}[]}) => ctor.fields)
      .find((field: {name: string}) => field.name === name)?.doc;
    expect(doc).toContain(meaning);
  });
  it('does not describe a NOT NULL epoch sync duration as nullable', () => {
    const entry = annotation(
      'cardano-db/src/Cardano/Db/Schema/Core/EpochAndProtocol.hs',
      'EpochSyncTime',
    );
    const field = entry.constructors
      .flatMap((ctor: {fields: {name: string; doc: string}[]}) => ctor.fields)
      .find((field: {name: string}) => field.name === 'epochSyncTimeSeconds');
    expect(field.doc).not.toContain('NULL');
  });
  it('names the actual staking reward category and renamed reward table', () => {
    const entry = annotation('cardano-db/src/Cardano/Db/Schema/Core/StakeDelegation.hs', 'Reward');
    expect(entry.doc).toContain('reward_rest');
    expect(entry.doc).not.toContain('instant_reward');
    const field = entry.constructors
      .flatMap((ctor: {fields: {name: string; doc: string}[]}) => ctor.fields)
      .find((field: {name: string}) => field.name === 'rewardEarnedEpoch');
    expect(field.doc).toContain('@member@');
    expect(field.doc).not.toContain('@pool@');
  });
  it.each([
    ['TxOutConfig', 'consumed mode must remain enabled'],
    ['TxOutConfig', 'pruning must remain enabled'],
    ['TxOutConfig', 'until the UTxO migration completes'],
    ['ForceTxIn', 'populates @tx_in@'],
    ['UseTxOutAddress', 'cannot be reverted'],
    ['LedgerInsertConfig', 'irreversibly'],
    ['LedgerInsertConfig', '@redeemer.fee@'],
    ['LedgerInsertConfig', '@tx.deposit@'],
  ])('%s preserves the operational contract: %s', (name, fact) => {
    expect(annotation('cardano-db-sync/src/Cardano/DbSync/Config/Types.hs', name)?.doc).toContain(
      fact,
    );
  });
  it.each([
    ['FetchPoolErrorAPI', 'DD.MM.YYYY'],
    ['FetchPoolErrorAPI', '10'],
    ['FetchPoolErrorAPI', 'retryCount'],
    ['RetiredPoolsAPI', '/api/v1/retired'],
    ['BasicAuthURL', '--admins'],
    ['AddTickerAPI', 'not need to be currently used'],
  ])('%s preserves the SMASH reference: %s', (name, fact) => {
    const entries = artifact.files
      .find(
        (entry: {path: string}) =>
          entry.path === 'cardano-smash-server/src/Cardano/SMASH/Server/Api.hs',
      )
      .annotations.filter((entry: {name: string}) => entry.name === name);
    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) expect(entry.doc).toContain(fact);
  });
  it('records pool metadata queue success and failure destinations', () => {
    const doc = annotation(
      'cardano-db-sync/src/Cardano/DbSync/OffChain/FetchQueue.hs',
      'newRetry',
    )?.doc;
    expect(doc).toContain('pool_metadata_ref');
    expect(doc).toContain('off_chain_pool_data');
    expect(doc).toContain('off_chain_pool_fetch_error');
  });
});
