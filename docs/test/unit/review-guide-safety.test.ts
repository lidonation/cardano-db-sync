import {existsSync, readFileSync, readdirSync} from 'node:fs';
import path from 'node:path';
import {describe, expect, it} from 'vitest';
import {DatabaseSync} from 'node:sqlite';

const root = path.resolve(import.meta.dirname, '../..');
const read = (name: string) =>
  readFileSync(path.join(root, 'migration/guides', `${name}.md`), 'utf8');

describe('staged guide safety regressions', () => {
  it('does not start the example database on all network interfaces', () => {
    const docker = read('docker');
    expect(docker).toContain('127.0.0.1:5432:5432');
    expect(docker).toContain('ports: !override');
    expect(docker).not.toContain('psql -h 0.0.0.0');
    expect(docker).toContain('-f docker-test.yml -f docker-compose.local.yml up');
    expect(docker).not.toContain('echo "localhost:5432:cexplorer:postgres:');
  });
  it('uses complete container commands, qualified image names and shared socket mounts', () => {
    const docker = read('docker');
    expect(docker).not.toContain('ghcr.io/IntersectMBO/');
    expect(docker).not.toMatch(/--volume node-ipc\s*\\/);
    expect(docker).not.toMatch(/--volume \$PWD:\/data\n\s+ghcr/);
    expect(docker).not.toContain('run --config');
    expect(docker).toContain('cabal run cardano-db-tool -- run-migrations');
    expect(docker).toMatch(/ghcr.io\/intersectmbo\/cardano-smash-server:[^\n]+ \\\n {2}--config/);
  });
  it('checks the rollback tip before the deletion point while writers remain stopped', () => {
    const rollback = read('manual-rollbacks');
    expect(rollback).not.toContain('at or just after your specified rollback slot');
    expect(rollback).toContain('strictly before the requested slot');
    expect(rollback).toContain('Keep db-sync stopped during this check');
    expect(rollback).not.toContain('Manual cleanup may be needed');
  });
  it('contains executable historical UTxO SQL and the current pool metadata table name', () => {
    const sql = read('interesting-queries');
    expect(sql).not.toContain('# with const');
    expect(sql).not.toContain('offchain_pool_data');
    expect(sql).toContain('off_chain_pool_data');
  });
  it('accounts for collateral inputs and returns rather than unrelated transaction rows', () => {
    const sql = read('interesting-queries');
    expect(sql).toContain('FROM collateral_tx_in');
    expect(sql).toContain('FROM collateral_tx_out');
    expect(sql).toContain('tx_out.tx_id = collateral_tx_in.tx_out_id');
    expect(sql).toContain('tx_out."index" = collateral_tx_in.tx_out_index');
    expect(sql).not.toContain('join tx_out on tx_in.tx_out_id = tx_out.id');
  });
  it('executes the documented collateral arithmetic without duplicating returns', () => {
    const text = read('interesting-queries');
    const section = text.split('### Get the sum of collatereal input lost')[1];
    const query = /```sql\n([\s\S]*?)\n```/.exec(section)![1];
    // This standard-SQL fixture verifies the join arithmetic, not PostgreSQL deployment parity.
    const db = new DatabaseSync(':memory:');
    try {
      db.exec(`
        CREATE TABLE tx (id INTEGER PRIMARY KEY, valid_contract BOOLEAN);
        CREATE TABLE tx_out (id INTEGER PRIMARY KEY, tx_id INTEGER, "index" INTEGER, value INTEGER);
        CREATE TABLE collateral_tx_in (tx_in_id INTEGER, tx_out_id INTEGER, tx_out_index INTEGER);
        CREATE TABLE collateral_tx_out (tx_id INTEGER, value INTEGER);
        INSERT INTO tx VALUES (10, false), (11, false), (12, true);
        INSERT INTO tx_out VALUES (101, 1, 0, 10000000), (102, 1, 1, 5000000),
          (103, 2, 0, 7000000), (104, 3, 0, 99000000);
        INSERT INTO collateral_tx_in VALUES (10, 1, 0), (10, 1, 1), (11, 2, 0), (12, 3, 0);
        INSERT INTO collateral_tx_out VALUES (10, 4000000);
      `);
      expect(db.prepare(query).get()?.lost_amount).toBe(18);
      db.exec('DELETE FROM tx');
      expect(db.prepare(query).get()?.lost_amount).toBe(0);
    } finally {
      db.close();
    }
  });
  it('keeps relative links resolvable from the staged location', () => {
    const directory = path.join(root, 'migration/guides');
    for (const name of readdirSync(directory).filter((file) => file.endsWith('.md'))) {
      const text = readFileSync(path.join(directory, name), 'utf8');
      for (const [, href] of text.matchAll(/\]\(([^)]+)\)/g)) {
        const file = href.split('#')[0];
        if (file && !file.includes(':'))
          expect(existsSync(path.resolve(directory, file)), `${name}: ${href}`).toBe(true);
      }
    }
  });
});
