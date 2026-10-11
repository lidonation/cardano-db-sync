import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

import {findProblems, main} from '../../scripts/check-schema.mjs';
import {fingerprint} from '../../scripts/lib/schema-model.mjs';

const docsRoot = path.resolve(import.meta.dirname, '../..');
const committed = JSON.parse(fs.readFileSync(path.join(docsRoot, 'generated/schema.json'), 'utf8'));

/*
 * Mutated copies live in a temporary docs root whose parent links back to the real repository, so
 * Haskell source paths still resolve.
 */
let tmpRepo: string;
let tmpDocs: string;

beforeEach(() => {
  tmpRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'b08-check-'));
  tmpDocs = path.join(tmpRepo, 'docs');
  fs.mkdirSync(path.join(tmpDocs, 'generated'), {recursive: true});
  fs.symlinkSync(path.resolve(docsRoot, '../cardano-db'), path.join(tmpRepo, 'cardano-db'));
});

afterEach(() => {
  fs.rmSync(tmpRepo, {recursive: true, force: true});
});

function withArtifact(mutate: (a: typeof committed) => void) {
  const copy = structuredClone(committed);
  mutate(copy);
  fs.writeFileSync(path.join(tmpDocs, 'generated/schema.json'), JSON.stringify(copy));
  return findProblems(tmpDocs);
}

describe('check:schema on the committed artifact', () => {
  it('is sound', () => {
    expect(findProblems(docsRoot)).toEqual([]);
  });

  it('main reports a summary and exits 0', () => {
    const out = {log: vi.fn(), error: vi.fn()};
    expect(main(docsRoot, out)).toBe(0);
    expect(out.log.mock.calls[0][0]).toMatch(
      /^check:schema — version 1, \d+ tables, \d+ columns, \d+ domains$/,
    );
  });
});

describe('check:schema catches', () => {
  it('a missing or unparseable artifact', () => {
    expect(findProblems(tmpDocs)[0]).toMatch(/is missing/);
    fs.writeFileSync(path.join(tmpDocs, 'generated/schema.json'), '{');
    expect(findProblems(tmpDocs)[0]).toMatch(/not valid JSON/);
  });

  it('a hand-edited column (fingerprint mismatch)', () => {
    const problems = withArtifact((a) => {
      a.tables[0].columns[0].nullable = !a.tables[0].columns[0].nullable;
    });
    expect(problems).toEqual([expect.stringMatching(/fingerprint does not match the column/)]);
  });

  it('an unresolved domain, even with a recomputed fingerprint', () => {
    const problems = withArtifact((a) => {
      const col = a.tables.find((t: {name: string}) => t.name === 'epoch_finalized').columns[1];
      col.resolved_type.base = 'word128type';
      col.fingerprint = fingerprint(col);
    });
    expect(problems).toEqual([
      'epoch_finalized.out_sum [all]: domain word128type is unresolved (resolved_type.base names a domain)',
    ]);
  });

  it('a chain naming an unknown domain, a stray CHECK, a malformed resolved type', () => {
    const problems = withArtifact((a) => {
      const cols = a.tables.find((t: {name: string}) => t.name === 'epoch_finalized').columns;
      cols[1].resolved_type.domains = ['mystery'];
      cols[2].resolved_type.checks = [{domain: 'nope', definition: 'CHECK (true)'}];
      cols[3].resolved_type = {base: ''};
      cols[4].resolved_type.domains = null;
      cols[5].resolved_type.not_null = 'no';
      cols[6].nullable = 'yes';
      for (const c of cols) c.fingerprint = fingerprint(c);
    });
    expect(problems).toEqual([
      'epoch_finalized.out_sum [all]: domain chain names unknown domain mystery',
      'epoch_finalized.fees [all]: a CHECK is not attached to a domain on the chain',
      'epoch_finalized.tx_count [all]: resolved_type.base is missing',
      'epoch_finalized.blk_count [all]: resolved_type.domains and resolved_type.checks must be arrays',
      'epoch_finalized.no [all]: resolved_type.not_null must be a boolean',
      'epoch_finalized.start_time [all]: nullable must be a boolean',
    ]);
  });

  it('a wrong version, Postgres major, or domain chain', () => {
    const problems = withArtifact((a) => {
      a.schemaVersion = 2;
      a.postgres = 16;
      a.domains.outsum.domains = ['word128type'];
    });
    expect(problems).toEqual([
      'schemaVersion is 2, expected 1',
      'postgres is 16, expected 17',
      'domain outsum: its chain must start with itself',
    ]);
  });

  it('unsorted, duplicated, unknown-variant, unknown-kind and empty tables', () => {
    const problems = withArtifact((a) => {
      const txOut = a.tables.findIndex(
        (t: {name: string; variant: string}) => t.name === 'tx_out' && t.variant === 'core',
      );
      [a.tables[txOut], a.tables[txOut + 1]] = [a.tables[txOut + 1], a.tables[txOut]];
      a.tables.push({...a.tables.at(-1), variant: 'all', name: 'zz_all'});
      a.tables.push({...a.tables.at(-1), variant: 'core', name: 'zz_all'});
      a.tables.push({...a.tables.at(-1), variant: 'odd', kind: 'thing', name: 'zzz', columns: []});
    });
    expect(problems).toEqual([
      'tx_out [core]: tables are not sorted by name, then variant',
      'zz_all [core]: a table tagged "all" cannot also appear per variant',
      'zzz [odd]: unknown variant',
      'zzz [odd]: unknown kind thing',
      'zzz [odd]: has no columns',
    ]);
  });

  it('a Haskell source path that does not exist, and an empty table list', () => {
    expect(
      withArtifact((a) => {
        a.tables[0].haskell = {record: 'X', file: 'cardano-db/src/Missing.hs'};
      }),
    ).toEqual([
      expect.stringMatching(/Haskell source cardano-db\/src\/Missing\.hs does not exist/),
    ]);
    expect(
      withArtifact((a) => {
        a.tables = [];
      }),
    ).toEqual(['tables is missing or empty']);
  });

  it('main prints every problem and exits 1', () => {
    withArtifact((a) => {
      a.postgres = 15;
    });
    const out = {log: vi.fn(), error: vi.fn()};
    expect(main(tmpDocs, out)).toBe(1);
    expect(out.error.mock.calls.map((c) => c[0])).toEqual([
      'check:schema — generated/schema.json failed 1 check(s):',
      '  postgres is 15, expected 17',
      'Regenerate it with: node scripts/extract-schema.mjs (needs Postgres 17).',
    ]);
  });
});
