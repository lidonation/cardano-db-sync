import path from 'node:path';

import {beforeEach, describe, expect, it, vi} from 'vitest';

const spawnSync = vi.hoisted(() => vi.fn());
vi.mock('node:child_process', () => ({spawnSync}));

import {
  applyMigrations,
  applySql,
  createDatabase,
  dropDatabase,
  migrationFiles,
  queryValue,
  readCatalog,
  selectMigrations,
  serverMajor,
} from '../../scripts/lib/schema-db.mjs';

const schemaDir = path.resolve(import.meta.dirname, '../../../schema');

const ok = (stdout = '') => ({status: 0, stdout, stderr: ''});

beforeEach(() => {
  spawnSync.mockReset();
});

describe('migration selection (mirrors Cardano.Db.Migration)', () => {
  const files = migrationFiles(schemaDir);

  it('lists the official migrations in lexical order', () => {
    expect(files.length).toBeGreaterThan(70);
    expect(files[0]).toEqual({name: 'migration-1-0000-20190730.sql', stage: 1, version: 0});
    const names = files.map((f) => f.name);
    expect(names).toEqual([...names].sort());
    // 2-0045 is dated after 2-0046: order is by version, never by date.
    expect(names.indexOf('migration-2-0045-20250708.sql')).toBeLessThan(
      names.indexOf('migration-2-0046-20250223.sql'),
    );
  });

  it('the address variant skips 4-0001, as filterIndexesFull does', () => {
    const core = selectMigrations(files, 'core').map((f) => f.name);
    const address = selectMigrations(files, 'address').map((f) => f.name);
    expect(core.some((n) => n.startsWith('migration-4-0001-'))).toBe(true);
    expect(address.some((n) => n.startsWith('migration-4-0001-'))).toBe(false);
    expect(core.length - address.length).toBe(1);
  });

  it('upTo rebuilds a historical schema and drops later stages', () => {
    const upTo = selectMigrations(files, 'core', {stage: 2, version: 29});
    expect(upTo.at(-1)!.name).toMatch(/^migration-2-0029-/);
    expect(upTo.every((f) => f.stage < 2 || (f.stage === 2 && f.version <= 29))).toBe(true);
  });
});

describe('psql calls', () => {
  it('runs queries with db-sync flags and returns trimmed output', () => {
    spawnSync.mockReturnValue(ok('170011\n'));
    expect(serverMajor('postgres')).toBe(17);
    const [cmd, args] = spawnSync.mock.calls[0];
    expect(cmd).toBe('psql');
    expect(args).toEqual(
      expect.arrayContaining(['--no-psqlrc', 'ON_ERROR_STOP=on', '-d', 'postgres']),
    );
    expect(queryValue('db', 'SELECT 1')).toBe('170011');
  });

  it('creates and drops databases, applies files and SQL in single transactions', () => {
    spawnSync.mockReturnValue(ok());
    createDatabase('postgres', 'x');
    dropDatabase('postgres', 'x');
    applyMigrations('x', '/s', [{name: 'migration-1-0000-1.sql', stage: 1, version: 0}]);
    applySql('x', 'ALTER TABLE t ADD c int');
    const calls = spawnSync.mock.calls.map(([, args, opts]) => ({
      args: args.join(' '),
      input: opts.input,
    }));
    expect(calls[0].args).toContain('CREATE DATABASE "x"');
    expect(calls[1].args).toContain('DROP DATABASE IF EXISTS "x" WITH (FORCE)');
    expect(calls[2].args).toContain('--single-transaction -d x -f /s/migration-1-0000-1.sql');
    expect(calls[3]).toEqual({
      args: expect.stringContaining('--single-transaction -d x'),
      input: 'ALTER TABLE t ADD c int',
    });
  });

  it('surfaces psql errors and a missing psql', () => {
    spawnSync.mockReturnValue({status: 3, stdout: '', stderr: 'ERROR: boom\n'});
    expect(() => queryValue('db', 'x')).toThrow(/failed:\nERROR: boom/);
    spawnSync.mockReturnValue({error: new Error('ENOENT')});
    expect(() => queryValue('db', 'x')).toThrow(/psql could not start: ENOENT/);
  });

  it('readCatalog groups columns by table and keys types by oid', () => {
    spawnSync.mockReturnValue(
      ok(
        JSON.stringify({
          types: [{oid: 100, name: 'word31type', kind: 'd'}],
          columns: [
            {table: 'block', name: 'id', position: 1},
            {table: 'block', name: 'hash', position: 2},
            {table: 'tx', name: 'id', position: 1},
          ],
          schemaVersion: {stage_one: 15, stage_two: 51, stage_three: 6},
        }),
      ),
    );
    const catalog = readCatalog('db');
    expect(catalog.types.get(100).name).toBe('word31type');
    expect([...catalog.tables.keys()]).toEqual(['block', 'tx']);
    expect(catalog.tables.get('block')).toHaveLength(2);
    expect(catalog.schemaVersion.stage_two).toBe(51);
  });
});
