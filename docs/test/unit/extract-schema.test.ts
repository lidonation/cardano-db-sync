import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

/*
 * The extractor's orchestration, with the database replaced by a canned catalog. The real replay
 * against Postgres runs in test/db (npm run test:schema-db) inside the extract-schema workflow.
 */
const db = vi.hoisted(() => ({
  serverMajor: vi.fn(),
  createDatabase: vi.fn(),
  dropDatabase: vi.fn(),
  applyMigrations: vi.fn(),
  applySql: vi.fn(),
  readCatalog: vi.fn(),
}));

vi.mock('../../scripts/lib/schema-db.mjs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../scripts/lib/schema-db.mjs')>();
  return {...actual, ...db};
});

import {
  extract,
  extractArtifact,
  main,
  replayCatalog,
  serialize,
} from '../../scripts/extract-schema.mjs';
import {readHaskellTables} from '../../scripts/lib/schema-haskell.mjs';

const repoRoot = path.resolve(import.meta.dirname, '../../..');

/** A catalog that agrees with the real Haskell records: every column bigint NOT NULL / NULL. */
function agreeingCatalog(variant: 'core' | 'address') {
  const tables = new Map();
  for (const t of readHaskellTables(repoRoot, variant).values()) {
    tables.set(t.table, [
      {
        name: 'id',
        type_oid: 20,
        elem_oid: null,
        format: 'bigint',
        not_null: true,
        default: null,
        kind: 'table',
      },
      ...t.columns.map((c: {column: string; nullable: boolean}) => ({
        name: c.column,
        type_oid: 20,
        elem_oid: null,
        format: 'bigint',
        not_null: !c.nullable,
        default: null,
        kind: 'table',
      })),
    ]);
  }
  return {types: new Map(), tables, schemaVersion: {stage_one: 1, stage_two: 2, stage_three: 3}};
}

const out = () => ({log: vi.fn(), error: vi.fn()});
let tmp: string;
let artifactPath: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'b08-extract-'));
  artifactPath = path.join(tmp, 'schema.json');
  for (const fn of Object.values(db)) fn.mockReset();
  db.serverMajor.mockReturnValue(17);
  let call = 0;
  db.readCatalog.mockImplementation(() => agreeingCatalog(call++ % 2 === 0 ? 'core' : 'address'));
});

afterEach(() => {
  fs.rmSync(tmp, {recursive: true, force: true});
});

describe('replayCatalog', () => {
  it('replays into a throwaway database and drops it even on failure', () => {
    db.readCatalog.mockReturnValueOnce('catalog');
    expect(replayCatalog({variant: 'core'})).toBe('catalog');
    expect(db.applySql).not.toHaveBeenCalled();
    const name = db.createDatabase.mock.calls[0][1];
    expect(name).toMatch(/^dbsync_schema_core_/);
    expect(db.dropDatabase).toHaveBeenCalledWith('postgres', name);

    db.applyMigrations.mockImplementationOnce(() => {
      throw new Error('migration failed');
    });
    expect(() => replayCatalog({variant: 'address'})).toThrow('migration failed');
    expect(db.dropDatabase).toHaveBeenCalledTimes(2);
  });

  it('applies the address-variant DDL after the migrations', () => {
    replayCatalog({variant: 'address'});
    expect(db.applySql).toHaveBeenCalledTimes(4);
    expect(db.applySql.mock.calls[1][1]).toContain('ALTER TABLE "tx_out"');
  });
});

describe('extract', () => {
  it('refuses a Postgres major other than 17', () => {
    db.serverMajor.mockReturnValue(16);
    expect(() => extract()).toThrow(/Postgres 16 found/);
  });

  it('builds the artifact when both sides agree', () => {
    const artifact = extract({adminDb: 'admin'});
    expect(db.serverMajor).toHaveBeenCalledWith('admin');
    expect(
      artifact.tables.find((t) => t.name === 'tx_out' && t.variant === 'address'),
    ).toBeTruthy();
  });

  it('lists every disagreement instead of shipping a partial schema', () => {
    db.readCatalog.mockImplementation(() => ({...agreeingCatalog('core'), tables: new Map()}));
    expect(() => extract()).toThrow(
      /The Haskell schema records and the migrations disagree \(\d+\):\n {2}- \[core\]/,
    );
    expect(extractArtifact().problems.length).toBeGreaterThan(100);
  });
});

describe('serialize and main', () => {
  it('serialises with the repository prettier config', async () => {
    const text = await serialize({schemaVersion: 1, tables: [{name: 'a', columns: ['x']}]});
    expect(text).toBe('{"schemaVersion": 1, "tables": [{"name": "a", "columns": ["x"]}]}\n');
  });

  it('writes the artifact, then --check passes on it', async () => {
    const o = out();
    expect(await main([], o, artifactPath)).toBe(0);
    expect(o.log.mock.calls[0][0]).toMatch(/^Wrote generated\/schema\.json: \d+ tables/);
    expect(await main(['--check'], o, artifactPath)).toBe(0);
    expect(o.log.mock.calls[1][0]).toMatch(/^No drift/);
  });

  it('--check fails on drift and on a missing artifact', async () => {
    fs.writeFileSync(artifactPath, '{}\n');
    const o = out();
    expect(await main(['--check'], o, artifactPath)).toBe(1);
    expect(o.error.mock.calls[0][0]).toMatch(/has drifted from a fresh extraction/);
    fs.rmSync(artifactPath);
    expect(await main(['--check'], out(), artifactPath)).toBe(1);
  });
});
