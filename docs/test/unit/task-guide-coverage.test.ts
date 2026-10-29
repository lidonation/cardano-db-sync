import {readFileSync} from 'node:fs';
import path from 'node:path';
import {describe, expect, it} from 'vitest';
const dir = path.resolve(import.meta.dirname, '../../docs/guides');
const read = (file: string) => readFileSync(path.join(dir, file), 'utf8');
describe('operational guides migrated from mixed reference sources', () => {
  it('explains destructive pruning and declares the required schema and settings', () => {
    const text = read('trimming.md');
    expect(text).toContain('tx_out.consumed_by_tx_id');
    expect(text).toContain('insert_options.tx_out.value');
    expect(text).toContain('insert_options.tx_out.force_tx_in');
    expect(text).toMatch(/backup/i);
    expect(text).toMatch(/irreversible|cannot recover/i);
  });
  it('covers the metadata debugging commands without duplicating the reference', () => {
    const text = read('pool-metadata.md');
    expect(text).toContain('http-get-json-metadata');
    expect(text).toContain('test-http-get-json-metadata');
    expect(text).toContain('insert_options.offchain_pool_data');
  });
  it('provides protected SMASH operations without embedding passwords in commands', () => {
    const text = read('smash-operations.md');
    expect(text).toContain('cardano-smash-server');
    expect(text).toContain('--admins');
    expect(text).toMatch(/protect|restrict/i);
    expect(text).not.toMatch(/curl[^\n]*-u\s+[^\s]+:[^\s]+/);
  });
});

describe('task-shaped recovery and query guides', () => {
  it('restores only into an explicitly prepared target and warns about snapshot trust', () => {
    const text = read('restore-from-snapshot.md');
    expect(text).toContain('--restore-snapshot');
    expect(text).toMatch(/empty database/i);
    expect(text).toMatch(/trusted/i);
    expect(text).toMatch(/backup/i);
  });
  it('documents how to monitor and how to choose a rollback safely', () => {
    const text = read('monitoring-rollback.md');
    expect(text).toContain('cardano-db-tool rollback');
    expect(text).toMatch(/stop db-sync/i);
    expect(text).toMatch(/backup/i);
    expect(text).toContain('SELECT');
  });
  it('includes beginner queries with the required schema declarations', () => {
    const text = read('first-queries.md');
    expect(text).toContain('tables: [block]');
    expect(text).toContain('block.slot_no');
    expect(text).toContain('SELECT');
    expect(text).toMatch(/read.only/i);
  });
});
