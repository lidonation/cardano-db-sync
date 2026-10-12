import path from 'node:path';

import {describe, expect, it} from 'vitest';

import {readHaskellTables} from '../../scripts/lib/schema-haskell.mjs';
import {findColumn, findDomain, findTable, loadSchema, variantTables} from '../../src/data/schema';

/*
 * The committed artifact, pinned against the facts B08's Definition of Done names. These run in the
 * docs pipeline with no database: they read what the extraction committed.
 */
const repoRoot = path.resolve(import.meta.dirname, '../../..');
const WORD128_BASE = 'numeric(39,0)';

describe('the canonical chain (GDE-6)', () => {
  it('outsum → word128type → numeric(39,0), with no CHECK left since migration 2-0030', () => {
    expect(findDomain('outsum')).toEqual({
      base: WORD128_BASE,
      domains: ['outsum', 'word128type'],
      checks: [],
      not_null: false,
    });
  });

  it('epoch_finalized.out_sum resolves through word128type, not to the domain name', () => {
    const column = findColumn('epoch_finalized', 'out_sum')!;
    expect(column.type).toBe('word128type');
    expect(column.resolved_type.base).toBe(WORD128_BASE);
    expect(column.resolved_type.domains).toEqual(['word128type']);
    expect(column.nullable).toBe(false);
  });

  it('tx_out.value resolves lovelace to numeric(20,0)', () => {
    expect(findColumn('tx_out', 'value')!.resolved_type).toMatchObject({
      base: 'numeric(20,0)',
      domains: ['lovelace'],
    });
  });
});

describe('completeness (SCH-1)', () => {
  const schema = loadSchema();

  it('zero unresolved domains: no resolved base type names a domain', () => {
    const domains = new Set(Object.keys(schema.domains));
    const unresolved = schema.tables.flatMap((t) =>
      t.columns
        .filter((c) => domains.has(c.resolved_type.base.replace(/\[\]$/, '')))
        .map((c) => `${t.name}.${c.name}`),
    );
    expect(unresolved).toEqual([]);
  });

  it('every column of every Haskell schema record has a fingerprint, in both variants', () => {
    const missing: string[] = [];
    for (const variant of ['core', 'address'] as const) {
      for (const table of readHaskellTables(repoRoot, variant).values()) {
        for (const column of table.columns) {
          const found = findColumn(table.table, column.column, variant);
          if (!found?.fingerprint.startsWith('sha256:'))
            missing.push(`${variant}:${table.table}.${column.column}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it('records the schema_version the artifact describes', () => {
    expect(schema.dbSchemaVersion.stage_two).toBeGreaterThanOrEqual(51);
  });
});

describe('variants', () => {
  it('tags the tables that differ between the core and address tx_out variants', () => {
    expect(variantTables().map((t) => `${t.name}:${t.variant}`)).toEqual(
      expect.arrayContaining([
        'tx_out:core',
        'tx_out:address',
        'collateral_tx_out:core',
        'address:address',
      ]),
    );
    expect(findColumn('tx_out', 'address', 'core')).toBeDefined();
    expect(findColumn('tx_out', 'address', 'address')).toBeUndefined();
    expect(findColumn('tx_out', 'address_id', 'address')!.nullable).toBe(false);
    expect(findTable('address')).toBeUndefined();
    expect(findTable('block', 'address')!.variant).toBe('all');
  });

  it('keeps the epoch view because the Epoch record reads it, and no other view', () => {
    const views = loadSchema().tables.filter((t) => t.kind === 'view');
    expect(views.map((t) => [t.name, t.haskell?.record])).toEqual([['epoch', 'Epoch']]);
  });
});
