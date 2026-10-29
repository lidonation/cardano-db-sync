import fs from 'node:fs';
import path from 'node:path';
import {describe, expect, it} from 'vitest';

import {maskHaskell} from '../../scripts/lib/schema-haskell.mjs';

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
    ['pRejectDisableInOut', '--disable-in-out', 'tx_in'],
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
    ['Core/Pool', 'PoolUpdate', 'poolUpdateMargin', 'fraction'],
    [
      'Core/GovernanceAndVoting',
      'Constitution',
      'constitutionVotingAnchorId',
      'VotingAnchor table index',
    ],
    [
      'Core/GovernanceAndVoting',
      'GovActionProposal',
      'govActionProposalVotingAnchorId',
      'VotingAnchor table index',
    ],
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
  it('describes voting power as a per-epoch aggregate, not an individual delegation', () => {
    const doc = annotation(
      'cardano-db/src/Cardano/Db/Schema/Core/GovernanceAndVoting.hs',
      'DrepDistr',
    )?.doc;
    expect(doc).toContain('per DRep and epoch');
    expect(doc).toContain('not individual delegations');
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
  it.each(['core', 'address'])(
    'joins %s multi-asset column docs through the committed schema',
    (variant) => {
      const schema = JSON.parse(
        fs.readFileSync(path.resolve(import.meta.dirname, '../../generated/schema.json'), 'utf8'),
      );
      const table = schema.tables.find(
        (table: {name: string; variant: string}) =>
          table.name === 'ma_tx_out' && table.variant === variant,
      );
      const entry = annotation(table.haskell.file, table.haskell.record);
      const fields = entry.constructors.flatMap(
        (ctor: {fields: {name: string; doc: string}[]}) => ctor.fields,
      );
      for (const [name, meaning] of [
        ['ident', 'MultiAsset table index'],
        ['quantity', 'amount'],
        ['tx_out_id', 'TxOut table index'],
      ]) {
        const column = table.columns.find((column: {name: string}) => column.name === name);
        expect(
          fields.find((field: {name: string}) => field.name === column.haskell.field)?.doc,
        ).toContain(meaning);
      }
    },
  );

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

// This audit checks current behavior, not parity with legacy prose.
describe('current implementation audit', () => {
  const get = (suffix: string, name: string) =>
    artifact.files
      .find((file: {path: string}) => file.path.endsWith(suffix))
      ?.annotations.find((entry: {name: string}) => entry.name === name);
  const field = (suffix: string, record: string, name: string): string =>
    get(suffix, record)
      ?.constructors.flatMap((ctor: {fields: {name: string; doc: string}[]}) => ctor.fields)
      .find((entry: {name: string}) => entry.name === name)?.doc ?? '';
  it('exports one canonical schema narrative without contradictory old boilerplate', () => {
    const records = artifact.files
      .flatMap((file: {annotations: {doc: string}[]}) => file.annotations)
      .filter((entry: {doc: string}) => entry.doc?.includes('Schema reference for @'));
    expect(records.length).toBeGreaterThanOrEqual(78);
    for (const entry of records) {
      expect(entry.doc).not.toContain('Table Name:');
      expect(entry.doc).not.toContain('incredibly slow');
      expect(entry.doc).not.toContain('Decentralized Reputation');
    }
    expect(get('/Core/EpochAndProtocol.hs', 'Epoch').doc).not.toContain('bigint >= 0');
  });
  it.each([
    ['/Core/Base.hs', 'Block', 'blockOpCert', 'KES hot verification key'],
    ['/Core/Base.hs', 'Redeemer', 'redeemerPurpose', '@vote@'],
    ['/Core/Base.hs', 'Redeemer', 'redeemerPurpose', '@propose@'],
    ['/Core/Base.hs', 'Datum', 'datumTxId', 'datum'],
    ['/Core/Base.hs', 'Script', 'scriptJson', 'multisig'],
    ['/Core/Base.hs', 'Script', 'scriptBytes', 'Dijkstra native'],
    ['/Core/Base.hs', 'RedeemerData', 'redeemerDataTxId', 'redeemer data'],
    [
      '/Core/EpochAndProtocol.hs',
      'EpochState',
      'epochStateNoConfidenceId',
      'enacted no-confidence',
    ],
    ['/Core/GovernanceAndVoting.hs', 'GovActionProposal', 'govActionProposalDescription', 'JSON'],
  ])('%s %s.%s matches its current producer', (file, record, name, fact) => {
    expect(field(file, record, name)).toContain(fact);
  });
  it('describes the actual mark snapshot used for next-epoch stake', () => {
    const doc = get('/Core/StakeDelegation.hs', 'EpochStake').doc;
    expect(doc).toContain('@mark@');
    expect(doc).not.toContain('@set@');
  });
  it('does not promise all optional vote metadata tables for every valid anchor', () => {
    const doc = get('/Core/OffChain.hs', 'OffChainVoteData').doc;
    expect(doc).toContain('anchor type');
    expect(doc).toContain('optional');
    expect(doc).not.toContain('All related');
    expect(field('/Core/OffChain.hs', 'OffChainVoteData', 'offChainVoteDataIsValid')).toContain(
      'applicable CIP',
    );
  });
  it.each(['TxOutCore', 'TxOutAddress', 'CollateralTxOutCore', 'CollateralTxOutAddress'])(
    'does not tie %s datum hashes to script presence',
    (record) => {
      const module = record.endsWith('Core') ? 'Core' : 'Address';
      const name = record[0].toLowerCase() + record.slice(1) + 'DataHash';
      const doc = field(`/Variants/TxOut${module}.hs`, record, name);
      expect(doc).toContain('no datum hash');
      expect(doc).not.toContain('without scripts');
    },
  );
  it('documents the selection contracts and independent identity/data handling', () => {
    expect(get('/Config/Types.hs', 'ShelleyInsertConfig').doc).toContain('Identity rows');
    expect(get('/Config/Types.hs', 'MultiAssetConfig').doc).toContain('minted and output');
    expect(get('/Config/Types.hs', 'PlutusConfig').doc).toContain('reference scripts');
    expect(get('/Config/Types.hs', 'SyncInsertConfig').doc).toContain('json_type');
    const cli = get('/app/cardano-db-sync.hs', 'pRejectDisableInOut').doc;
    expect(cli).toContain('retired');
    expect(cli).toContain('tx_out.value');
  });
  it('does not falsely promise null transaction deposits without the ledger', () => {
    const doc = get('/Config/Types.hs', 'LedgerInsertConfig').doc;
    expect(doc).toContain('computed from resolved inputs');
    expect(doc).toContain('disable or ignore');
    expect(doc).not.toContain('@redeemer.fee@ and @tx.deposit@ are null');
  });
  it('makes the rollback deletion boundary explicit', () => {
    const doc = get('/app/cardano-db-sync.hs', 'pRollbackSlotNo').doc;
    expect(doc).toContain('inclusive');
    expect(doc).toContain('preceding block');
  });
  it('records the exact snapshot threshold and consistency conditions', () => {
    const doc = get('/Config/Types.hs', 'SnapshotIntervalConfig').doc;
    expect(doc).toContain('at or above');
    expect(doc).toContain('consistent');
    expect(doc).toContain('ten days');
  });
});

// Source-level guards supplement, but do not replace, runtime and mock-database tests.
describe('runtime evidence for configuration contracts', () => {
  const sourceRoot = path.resolve(import.meta.dirname, '../../../cardano-db-sync/src');
  const sources = fs
    .readdirSync(sourceRoot, {recursive: true, withFileTypes: true})
    .filter((entry) => entry.isFile() && entry.name.endsWith('.hs'))
    .map((entry) => ({
      file: path.join(entry.parentPath, entry.name),
      code: maskHaskell(fs.readFileSync(path.join(entry.parentPath, entry.name), 'utf8')),
    }));
  it.each(['ShelleyStakeAddrs', 'MultiAssetPolicies', 'PlutusScripts'])(
    '%s is propagated into runtime options',
    (symbol) => {
      const builder = sources.find(({file}) => file.endsWith('/DbSync.hs'))!.code;
      expect(builder).toContain(symbol);
    },
  );
  it('rejects retired JSON and CLI selectors rather than accepting no-ops', () => {
    const config = fs.readFileSync(path.join(sourceRoot, 'Cardano/DbSync/Config/Types.hs'), 'utf8');
    const cli = fs.readFileSync(path.resolve(sourceRoot, '../app/cardano-db-sync.hs'), 'utf8');
    expect(config).toContain('KeyMap.member "json_type" obj');
    expect(config).toContain('insert_options.json_type is retired');
    expect(cli).toContain('Opt.abortOption');
    expect(cli).toContain('--disable-in-out is retired');
  });
  it('metadata keys are actually passed into the runtime and filtered', () => {
    const builder = sources.find(({file}) => file.endsWith('/DbSync.hs'))!.code;
    const insert = sources.find(({file}) => file.endsWith('/Insert/Tx.hs'))!.code;
    expect(builder).toContain('ioKeepMetadataNames = maybeKeepMNames');
    expect(insert).toContain('key `elem` metadataNames');
  });
});
