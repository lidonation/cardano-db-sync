import {readFileSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {beforeEach, describe, expect, it, vi} from 'vitest';
const db = vi.hoisted(() => ({
  serverMajor: vi.fn(),
  createDatabase: vi.fn(),
  dropDatabase: vi.fn(),
  applyMigrations: vi.fn(),
  applySql: vi.fn(),
  readCatalog: vi.fn(),
  queryValue: vi.fn(),
}));
vi.mock('../../scripts/lib/schema-db.mjs', async (original) => ({
  ...(await original<typeof import('../../scripts/lib/schema-db.mjs')>()),
  ...db,
}));
import {extractExplorer, main, typedRelationships} from '../../scripts/extract-schema-explorer.mjs';
const repo = path.resolve(import.meta.dirname, '../../..');
beforeEach(() => {
  for (const fn of Object.values(db)) fn.mockReset();
  db.serverMajor.mockReturnValue(17);
  let n = 0;
  db.readCatalog.mockImplementation(() => ({
    types: new Map(),
    tables: new Map([
      [
        'ada_pots',
        [
          {
            name: 'deposits_stake',
            format: 'bigint',
            type_oid: 20,
            not_null: n++ === 0,
            default: null,
          },
        ],
      ],
    ]),
  }));
  db.queryValue.mockImplementation((_name: string, sql: string) =>
    sql.includes('row_to_json') ? '{"stage_two":52}' : '[]',
  );
});
describe('B18 extraction', () => {
  it('uses one core replay and one address replay, preserving their different execution order', () => {
    const artifact = extractExplorer() as import('../../src/schema/types').ExplorerHistory;
    expect(artifact.current).toEqual({stageTwo: 52, stageFour: 9});
    expect(artifact.changes['core:ada_pots.deposits_stake']).toHaveLength(2);
    // Shared definitions render from core history: no duplicate address copy.
    expect(artifact.changes['address:ada_pots.deposits_stake']).toBeUndefined();
    expect(db.createDatabase).toHaveBeenCalledTimes(2);
    expect(db.dropDatabase).toHaveBeenCalledTimes(2);
    expect(db.applySql).toHaveBeenCalled();
    expect(
      db.applyMigrations.mock.calls
        .at(-1)?.[2]
        .some((f: {stage: number; version: number}) => f.stage === 4 && f.version === 1),
    ).toBe(false);
  });
  it('gives a definition the address conversion changes its core events plus the runtime event', () => {
    const catalog = db.readCatalog.getMockImplementation()!;
    let addressReads = 0;
    db.readCatalog.mockImplementation((name: string) => {
      const result = catalog(name);
      // The second address-database read is the catalog after runtime conversion.
      if (name.endsWith('_address') && ++addressReads === 2)
        for (const column of result.tables.get('ada_pots')) column.format = 'numeric';
      return result;
    });
    const artifact = extractExplorer() as import('../../src/schema/types').ExplorerHistory;
    const events = artifact.changes['address:ada_pots.deposits_stake'];
    expect(events.slice(0, -1)).toEqual(artifact.changes['core:ada_pots.deposits_stake']);
    expect(events.at(-1)?.migration).toBe('runtime:tx_out.use_address_table');
  });
  it('rejects other Postgres majors before creating a database and drops its own DB on replay failure', () => {
    db.serverMajor.mockReturnValue(18);
    expect(extractExplorer).toThrow(/Postgres 17/);
    expect(db.createDatabase).not.toHaveBeenCalled();
    db.serverMajor.mockReturnValue(17);
    db.readCatalog.mockImplementation(() => {
      throw new Error('catalog unavailable');
    });
    expect(extractExplorer).toThrow(/catalog unavailable/);
    expect(db.dropDatabase).toHaveBeenCalledTimes(1);
  });
  it('derives the non-obvious tx_in.tx_out_id relationship from its TxId type, not the column spelling', () => {
    const rows = typedRelationships(repo, 'core', []);
    expect(rows).toContainEqual({
      kind: 'typed-key',
      table: 'tx_in',
      columns: ['tx_out_id'],
      target: 'tx',
      targetColumns: ['id'],
      variant: 'core',
    });
  });
  it('writes deterministically and rejects seeded drift instead of silently repairing --check', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'explorer-'));
    try {
      const file = path.join(dir, 'schema-explorer.json');
      db.readCatalog.mockReturnValue({types: new Map(), tables: new Map()});
      await main([], file);
      const bytes = readFileSync(file, 'utf8');
      await main(['--check'], file);
      expect(readFileSync(file, 'utf8')).toBe(bytes);
      writeFileSync(file, '{}\n');
      await expect(main(['--check'], file)).rejects.toThrow(/drift/);
      expect(readFileSync(file, 'utf8')).toBe('{}\n');
    } finally {
      rmSync(dir, {recursive: true, force: true});
    }
  });
});
