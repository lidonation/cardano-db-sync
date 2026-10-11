import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {describe, expect, it} from 'vitest';

import {
  camelToSnake,
  fieldToColumn,
  parseStringList,
  readAddressVariantDdl,
  readDbInfoInstances,
  readHaskellTables,
  readRecords,
  readUnlinesBinding,
} from '../../scripts/lib/schema-haskell.mjs';

const repoRoot = path.resolve(import.meta.dirname, '../../..');
const sample = fs.readFileSync(
  path.join(import.meta.dirname, '../fixtures/schema/Sample.hs'),
  'utf8',
);

describe('column naming (mirrors Cardano.Db.Statement.Types)', () => {
  it('camelToSnake', () => {
    expect(camelToSnake('EpochNo')).toBe('epoch_no');
    expect(camelToSnake('TxOutId')).toBe('tx_out_id');
    expect(camelToSnake('')).toBe('');
  });

  it('fieldToColumn strips the record prefix', () => {
    expect(fieldToColumn('Block', 'blockEpochNo')).toBe('epoch_no');
    expect(fieldToColumn('CollateralTxOutCore', 'collateralTxOutCoreTxId')).toBe('tx_id');
    expect(() => fieldToColumn('Block', 'txHash')).toThrow(/record prefix 'block'/);
    expect(() => fieldToColumn('Block', 'blockhash')).toThrow(/record prefix/);
  });
});

describe('readRecords', () => {
  it('reads data and newtype records, Maybe nullability and sqltype hints', () => {
    const records = readRecords(sample, 'Sample.hs');
    expect([...records.keys()]).toEqual(['SampleBlock', 'Delisted', 'MaTxOutSample']);
    expect(records.get('SampleBlock')).toEqual([
      {field: 'sampleBlockHash', nullable: false, sqltype: 'hash32type'},
      {field: 'sampleBlockEpochNo', nullable: true, sqltype: 'word31type'},
      {field: 'sampleBlockVrfKey', nullable: true},
      {field: 'sampleBlockTxCount', nullable: false},
    ]);
    expect(records.get('Delisted')).toEqual([
      {field: 'delistedHashRaw', nullable: false, sqltype: 'hash28type'},
    ]);
  });

  it('fails loudly on a field line it does not recognise', () => {
    const broken = 'data X = X\n  { xA :: Int\n  , !weird\n  }\n';
    expect(() => readRecords(broken, 'X.hs')).toThrow(/X\.hs:3: unrecognised field line in X/);
  });
});

describe('readDbInfoInstances', () => {
  it('reads table and column overrides', () => {
    expect(readDbInfoInstances(sample, 'Sample.hs')).toEqual([
      {type: 'SampleBlock', file: 'Sample.hs', tableName: null, columnNames: null},
      {type: 'Delisted', file: 'Sample.hs', tableName: null, columnNames: null},
      {
        type: 'MaTxOutSample',
        file: 'Sample.hs',
        tableName: 'ma_tx_out',
        columnNames: ['quantity', 'tx_out_id'],
      },
    ]);
  });

  it('reads an instance at the end of a file', () => {
    expect(
      readDbInfoInstances('instance DbInfo Last where\n  tableName _ = "last"', 'L.hs')[0]
        .tableName,
    ).toBe('last');
  });

  it('reads an instance header with a trailing comment (review finding 3)', () => {
    const source = 'instance DbInfo X where -- comment\n  tableName _ = "x"\n';
    expect(readDbInfoInstances(source, 'X.hs')).toEqual([
      {type: 'X', file: 'X.hs', tableName: 'x', columnNames: null},
    ]);
  });

  it('fails on a DbInfo instance it cannot parse instead of dropping it', () => {
    const source = 'instance (Show a) => DbInfo (Wrapped a) where\n  tableName _ = "w"\n';
    expect(() => readDbInfoInstances(source, 'W.hs')).toThrow(
      /W\.hs: DbInfo instance\(s\) the reader cannot parse: instance \(Show a\) => DbInfo \(Wrapped a\) where/,
    );
  });

  it('fails when columnNames is not a list', () => {
    expect(() =>
      readDbInfoInstances('instance DbInfo X where\n  columnNames _ = names\n', 'X.hs'),
    ).toThrow(/no \[ … \] list/);
  });
});

describe('readUnlinesBinding', () => {
  it('reads Text.unlines lists and single literals, unescaping quotes', () => {
    expect(readUnlinesBinding(sample, 'alterQuery')).toBe(
      'ALTER TABLE "tx_out"\n  DROP COLUMN "address"\n',
    );
    expect(readUnlinesBinding(sample, 'singleQuery')).toBe(
      'CREATE INDEX IF NOT EXISTS idx ON t(c);',
    );
  });

  it('rejects a list item that is not a standalone literal (review finding 4)', () => {
    const withName =
      '  q =\n    Text.unlines\n      [ "SELECT"\n      , fragment\n      , "1"\n      ]\n';
    expect(() => readUnlinesBinding(withName, 'q')).toThrow(
      /q: list item is not a string literal: fragment/,
    );
    const concat = '  q =\n    Text.unlines\n      [ "SELECT" <> x\n      ]\n';
    expect(() => readUnlinesBinding(concat, 'q')).toThrow(
      /q: expected , or \] after a list item: <> x/,
    );
  });

  it('keeps a ] inside a literal and skips -- comments inside the list', () => {
    const source = '  q =\n    Text.unlines\n      [ "a text[]" -- why\n      , "b"\n      ]\n';
    expect(readUnlinesBinding(source, 'q')).toBe('a text[]\nb\n');
    expect(parseStringList('xs = []', 0, 'xs')).toEqual([]);
  });

  it('fails on a missing binding or an empty list', () => {
    expect(() => readUnlinesBinding(sample, 'nope')).toThrow(/nope: binding not found/);
    expect(() => readUnlinesBinding('  q =\n    Text.unlines\n      []\n', 'q')).toThrow(
      /list is empty/,
    );
  });
});

describe('the real schema modules', () => {
  it('every DbInfo instance resolves to a table with columns, for both variants', () => {
    const core = readHaskellTables(repoRoot, 'core');
    const address = readHaskellTables(repoRoot, 'address');
    expect(core.size).toBeGreaterThan(70);
    for (const table of [...core.values(), ...address.values()]) {
      expect(table.columns.length, table.table).toBeGreaterThan(0);
    }
    expect(core.get('tx_out')!.record).toBe('TxOutCore');
    expect(address.get('tx_out')!.record).toBe('TxOutAddress');
    expect(core.has('address')).toBe(false);
    expect(address.get('address')!.record).toBe('Address');
    expect(core.get('block')!.columns.find((c) => c.column === 'epoch_no')).toEqual({
      column: 'epoch_no',
      field: 'blockEpochNo',
      nullable: true,
      sqltype: 'word31type',
    });
  });

  it('rejects an unknown variant', () => {
    expect(() => readHaskellTables(repoRoot, 'shared')).toThrow(/unknown tx_out variant/);
  });

  it('reads the address-variant DDL from ConsumedTxOut.hs in run order', () => {
    const ddl = readAddressVariantDdl(repoRoot);
    expect(ddl).toHaveLength(4);
    expect(ddl[0]).toContain('DROP VIEW IF EXISTS utxo_view;');
    expect(ddl[1]).toContain('ALTER TABLE "tx_out"');
    expect(ddl[3]).toContain('CREATE TABLE "address"');
  });
});

describe('readHaskellTables failure modes', () => {
  function tree(files: Record<string, string>) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'b08-hs-'));
    const write = (rel: string, text: string) => {
      fs.mkdirSync(path.dirname(path.join(root, rel)), {recursive: true});
      fs.writeFileSync(path.join(root, rel), text);
    };
    write('cardano-db/src/Cardano/Db/Schema/Variants/TxOutCore.hs', '');
    for (const [rel, text] of Object.entries(files))
      write(`cardano-db/src/Cardano/Db/Schema/Core/${rel}`, text);
    return root;
  }

  it('fails on an instance without a record, a column count mismatch, or a duplicate table', () => {
    expect(() => readHaskellTables(tree({'A.hs': 'instance DbInfo Ghost\n'}), 'core')).toThrow(
      /Ghost has no record/,
    );
    const mismatch =
      'data A = A\n  { aX :: Int\n  }\n\ninstance DbInfo A where\n  columnNames _ = NE.fromList ["x", "y"]\n';
    expect(() => readHaskellTables(tree({'A.hs': mismatch}), 'core')).toThrow(
      /lists 2 columnNames for 1 record fields/,
    );
    const dup =
      'data A = A\n  { aX :: Int\n  }\n\ninstance DbInfo A where\n  tableName _ = "t"\n\ndata B = B\n  { bX :: Int\n  }\n\ninstance DbInfo B where\n  tableName _ = "t"\n';
    expect(() => readHaskellTables(tree({'A.hs': dup}), 'core')).toThrow(
      /table t is declared twice \(A, B\)/,
    );
  });
});
