import {describe, expect, it} from 'vitest';

import {
  buildArtifact,
  buildColumn,
  buildDomains,
  canonicalJson,
  changedFingerprints,
  crossCheck,
  domainTypedColumns,
  fingerprint,
  mergeVariants,
  relevantRelations,
  resolveColumnType,
  resolveDomain,
} from '../../scripts/lib/schema-model.mjs';

/*
 * A synthetic catalog shaped like the rows schema-db.mjs reads, reproducing the real chain:
 * outsum → word128type → numeric(39,0), with word128type's CHECK as it stood before 2-0030.
 */
const WORD128_CHECK =
  "CHECK (((VALUE >= (0)::numeric) AND (VALUE <= '340282366920938463463374607431768211455'::numeric)))";

type TypeRow = {
  oid: number;
  name: string;
  schema: string;
  kind: string;
  base_oid: number;
  base_format: string | null;
  not_null: boolean;
  default: string | null;
  checks: string[];
  labels: string[];
};

function domain(
  oid: number,
  name: string,
  baseOid: number,
  baseFormat: string,
  over: Partial<TypeRow> = {},
): TypeRow {
  return {
    oid,
    name,
    schema: 'public',
    kind: 'd',
    base_oid: baseOid,
    base_format: baseFormat,
    not_null: false,
    default: null,
    checks: [],
    labels: [],
    ...over,
  };
}

function catalog(word128Checks: string[] = [WORD128_CHECK], word128Base = 'numeric(39,0)') {
  return new Map<number, TypeRow>([
    [100, domain(100, 'word128type', 1700, word128Base, {checks: word128Checks})],
    [101, domain(101, 'outsum', 100, 'word128type')],
    [102, domain(102, 'word31type', 23, 'integer', {checks: ['CHECK ((VALUE >= 0))']})],
    [
      103,
      {
        oid: 103,
        name: 'rewardtype',
        schema: 'public',
        kind: 'e',
        base_oid: 0,
        base_format: null,
        not_null: false,
        default: null,
        checks: [],
        labels: ['leader', 'member'],
      },
    ],
    [104, domain(104, 'rewardkind', 103, 'rewardtype')],
    [105, domain(105, 'cardinal', 23, 'integer', {schema: 'information_schema'})],
  ]);
}

function row(name: string, typeOid: number, format: string, over: Record<string, unknown> = {}) {
  return {
    name,
    type_oid: typeOid,
    elem_oid: null,
    format,
    not_null: true,
    default: null,
    kind: 'table',
    ...over,
  };
}

/** A small deterministic PRNG (mulberry32) so the property runs are reproducible. */
function prng(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('canonicalJson', () => {
  it('sorts object keys at every level and leaves array order alone', () => {
    expect(canonicalJson({b: 1, a: {d: [2, 1], c: null}})).toBe('{"a":{"c":null,"d":[2,1]},"b":1}');
  });
});

describe('fingerprint (GDE-6)', () => {
  const column = {
    name: 'out_sum',
    resolved_type: {base: 'numeric(39,0)', domains: ['word128type'], checks: [], not_null: false},
    nullable: false,
    default: null,
  };

  it('hashes exactly (name, resolved_type, nullable, default)', () => {
    const fp = fingerprint(column);
    expect(fp).toMatch(/^sha256:[0-9a-f]{64}$/);
    // Fields outside the identity (declared type label, Haskell field) do not move it.
    expect(
      fingerprint({...column, type: 'word128type', haskell: {field: 'x'}} as typeof column),
    ).toBe(fp);
  });

  it('is independent of key order', () => {
    const reordered = {
      default: null,
      nullable: false,
      resolved_type: column.resolved_type,
      name: 'out_sum',
    };
    expect(fingerprint(reordered)).toBe(fingerprint(column));
  });

  it('property: any change to one identity field changes the fingerprint (seeded, 500 runs)', () => {
    const random = prng(0x5eed);
    const pick = <T>(xs: T[]) => xs[Math.floor(random() * xs.length)];
    const word = () => `c${Math.floor(random() * 1e9).toString(36)}`;
    for (let i = 0; i < 500; i++) {
      const base = {
        name: word(),
        resolved_type: {
          base: pick(['integer', 'numeric(20,0)', 'numeric(39,0)', 'bytea', 'bigint']),
          domains: random() < 0.5 ? [] : [word()],
          checks: random() < 0.5 ? [] : [{domain: 'd', definition: `CHECK ((VALUE >= ${i}))`}],
          not_null: random() < 0.5,
        },
        nullable: random() < 0.5,
        default: random() < 0.5 ? null : `${i}`,
      };
      const mutated = structuredClone(base);
      switch (Math.floor(random() * 6)) {
        case 0:
          mutated.name = `${base.name}_`;
          break;
        case 1:
          mutated.resolved_type.base = `${base.resolved_type.base} `;
          break;
        case 2:
          mutated.resolved_type.checks = base.resolved_type.checks.length
            ? []
            : [{domain: 'd', definition: 'CHECK ((VALUE >= 0))'}];
          break;
        case 3:
          mutated.nullable = !base.nullable;
          break;
        case 4:
          mutated.default = base.default === null ? '0' : null;
          break;
        default:
          mutated.resolved_type.domains = [...base.resolved_type.domains, 'extra'];
      }
      expect(fingerprint(mutated)).not.toBe(fingerprint(base));
      expect(fingerprint(structuredClone(base))).toBe(fingerprint(base));
    }
  });
});

describe('resolveDomain', () => {
  it('resolves outsum → word128type → numeric(39,0) transitively, with the CHECK attached', () => {
    const {resolved} = resolveDomain(101, catalog());
    expect(resolved).toEqual({
      base: 'numeric(39,0)',
      domains: ['outsum', 'word128type'],
      checks: [{domain: 'word128type', definition: WORD128_CHECK}],
      not_null: false,
    });
  });

  it('carries domain NOT NULL and the outermost default', () => {
    const types = catalog();
    types.set(100, {...types.get(100)!, not_null: true, default: '0'});
    types.set(101, {...types.get(101)!, default: '1'});
    expect(resolveDomain(101, types)).toEqual({
      resolved: expect.objectContaining({not_null: true}),
      default: '1',
    });
    types.set(101, {...types.get(101)!, default: null});
    expect(resolveDomain(101, types).default).toBe('0');
  });

  it('records enum labels when the chain ends at an enum', () => {
    expect(resolveDomain(104, catalog()).resolved).toEqual({
      base: 'rewardtype',
      domains: ['rewardkind'],
      checks: [],
      not_null: false,
      enum: ['leader', 'member'],
    });
  });

  it('fails on a cycle and on a non-domain', () => {
    const types = catalog();
    types.set(100, {...types.get(100)!, base_oid: 101});
    expect(() => resolveDomain(101, types)).toThrow(/domain cycle/);
    expect(() => resolveDomain(103, catalog())).toThrow(/not a domain/);
  });
});

describe('resolveColumnType', () => {
  it('handles plain types, enums and arrays of domains', () => {
    const types = catalog();
    expect(resolveColumnType(row('x', 20, 'bigint'), types).resolved.base).toBe('bigint');
    expect(resolveColumnType(row('t', 103, 'rewardtype'), types).resolved.enum).toEqual([
      'leader',
      'member',
    ]);
    const arr = resolveColumnType(row('a', 999, 'word31type[]', {elem_oid: 102}), types).resolved;
    expect(arr).toEqual({
      base: 'integer[]',
      domains: ['word31type'],
      checks: [{domain: 'word31type', definition: 'CHECK ((VALUE >= 0))'}],
      not_null: false,
    });
    expect(
      resolveColumnType(row('b', 1007, 'integer[]', {elem_oid: 23}), types).resolved.base,
    ).toBe('integer[]');
  });
});

describe('buildColumn', () => {
  it('derives nullability from the column and its domains, and the default from either', () => {
    const types = catalog();
    types.set(102, {...types.get(102)!, not_null: true, default: '7'});
    const col = buildColumn(row('blk_count', 102, 'word31type', {not_null: false}), types);
    expect(col.nullable).toBe(false);
    expect(col.default).toBe('7');
    const own = buildColumn(row('blk_count', 102, 'word31type', {default: '9'}), types);
    expect(own.default).toBe('9');
    expect(buildColumn(row('n', 20, 'bigint', {not_null: false}), catalog()).nullable).toBe(true);
    expect(buildColumn({...row('n', 20, 'bigint'), kind: undefined}, catalog()).kind).toBe('table');
  });

  it('regression (the 179-column incident): a domain change flips every dependent fingerprint', () => {
    const before = catalog();
    const dropped = catalog([]);
    const retyped = catalog([WORD128_CHECK], 'numeric(20,0)');
    const dependents = [
      row('out_sum', 100, 'word128type'),
      row('fees', 101, 'outsum'),
      row('total', 100, 'word128type'),
    ];
    for (const changed of [dropped, retyped]) {
      for (const dep of dependents) {
        const a = buildColumn(dep, before);
        const b = buildColumn(dep, changed);
        // Nothing about the column's own definition changed…
        expect(b.type).toBe(a.type);
        // …and still its contract did.
        expect(b.fingerprint).not.toBe(a.fingerprint);
      }
      // A column on an unrelated domain does not move.
      const other = row('tx_count', 102, 'word31type');
      expect(buildColumn(other, changed).fingerprint).toBe(buildColumn(other, before).fingerprint);
    }
  });
});

describe('buildDomains', () => {
  it('resolves only the db-sync schema domains, sorted', () => {
    const domains = buildDomains(catalog());
    expect(Object.keys(domains)).toEqual(['outsum', 'rewardkind', 'word128type', 'word31type']);
    expect(domains.outsum.domains).toEqual(['outsum', 'word128type']);
  });
});

const hsTable = (table: string, columns: Array<[string, boolean]>, record = 'Rec') => ({
  table,
  record,
  file: 'cardano-db/src/X.hs',
  columns: columns.map(([column, nullable]) => ({column, field: `rec_${column}`, nullable})),
});

describe('crossCheck', () => {
  const types = catalog();
  const db = new Map([
    [
      'epoch',
      [
        row('id', 20, 'bigint'),
        row('out_sum', 100, 'word128type'),
        row('no', 102, 'word31type'),
      ].map((r) => buildColumn(r, types)),
    ],
    [
      'view_t',
      [row('a', 20, 'bigint', {not_null: false, kind: 'view'})].map((r) => buildColumn(r, types)),
    ],
  ]);

  it('passes when both sides agree (id is implicit, views skip nullability)', () => {
    const hs = new Map([
      [
        'epoch',
        hsTable('epoch', [
          ['out_sum', false],
          ['no', false],
        ]),
      ],
      ['view_t', hsTable('view_t', [['a', false]])],
    ]);
    expect(crossCheck('core', db, hs)).toEqual([]);
  });

  it('reports a missing table, a missing or extra column, and a nullability flip', () => {
    const hs = new Map([
      [
        'epoch',
        hsTable('epoch', [
          ['out_sum', true],
          ['gone', false],
        ]),
      ],
      ['nowhere', hsTable('nowhere', [['x', false]], 'Nowhere')],
    ]);
    const problems = crossCheck('core', db, hs);
    expect(problems).toEqual([
      '[core] epoch.out_sum: database says NOT NULL, Rec.rec_out_sum says Maybe',
      '[core] epoch.gone (Rec.rec_gone) is not in the database',
      '[core] epoch.no is in the database but not in Rec',
      '[core] cardano-db/src/X.hs: Nowhere declares table nowhere, which the migrations never create',
    ]);
    const flipped = new Map([
      [
        'epoch',
        hsTable('epoch', [
          ['out_sum', false],
          ['no', true],
        ]),
      ],
    ]);
    expect(crossCheck('core', db, flipped)).toEqual([
      '[core] epoch.no: database says NOT NULL, Rec.rec_no says Maybe',
    ]);
  });
});

describe('relevantRelations', () => {
  it('keeps tables and only the views a Haskell record reads', () => {
    const tables = new Map([
      ['t', [{kind: 'table'}]],
      ['epoch', [{kind: 'view'}]],
      ['utxo_view', [{kind: 'view'}]],
    ]);
    expect([...relevantRelations(tables, new Map([['epoch', {}]])).keys()]).toEqual(['t', 'epoch']);
  });
});

describe('mergeVariants', () => {
  const types = catalog();
  const cols = (names: string[]) => names.map((n) => buildColumn(row(n, 20, 'bigint'), types));

  it('collapses identical tables to "all" and tags the rest per variant', () => {
    const db = {
      core: new Map([
        ['block', cols(['id', 'hash'])],
        ['tx_out', cols(['id', 'address'])],
      ]),
      address: new Map([
        ['block', cols(['id', 'hash'])],
        ['tx_out', cols(['id', 'address_id'])],
        ['address', cols(['id', 'raw'])],
      ]),
    };
    const hs = {
      core: new Map([['block', hsTable('block', [['hash', false]])]]),
      address: new Map([['block', hsTable('block', [['hash', false]])]]),
    };
    const merged = mergeVariants(db, hs);
    expect(merged.map((t) => `${t.name}:${t.variant}`)).toEqual([
      'address:address',
      'block:all',
      'tx_out:core',
      'tx_out:address',
    ]);
    const block = merged.find((t) => t.name === 'block')!;
    expect(block.haskell).toEqual({record: 'Rec', file: 'cardano-db/src/X.hs'});
    expect(block.kind).toBe('table');
    expect(block.columns[1].haskell).toEqual({field: 'rec_hash'});
    expect(block.columns[0]).not.toHaveProperty('haskell');
    expect(block.columns[0]).not.toHaveProperty('kind');
  });

  it('keeps the sqltype hint when the record carries one', () => {
    const db = {core: new Map([['b', cols(['id', 'h'])]]), address: new Map()};
    const t = hsTable('b', [['h', false]]);
    t.columns[0] = {...t.columns[0], sqltype: 'hash32type'} as (typeof t.columns)[number];
    const merged = mergeVariants(db, {core: new Map([['b', t]]), address: new Map()});
    expect(merged[0].variant).toBe('core');
    expect(merged[0].columns[1].haskell).toEqual({field: 'rec_h', sqltype: 'hash32type'});
  });
});

describe('buildArtifact and fingerprint diffs', () => {
  function catalogs(types: Map<number, TypeRow>) {
    const tables = new Map([
      [
        'epoch_finalized',
        [
          row('id', 20, 'bigint'),
          row('out_sum', 100, 'word128type'),
          row('tx_count', 102, 'word31type'),
        ],
      ],
      ['utxo_view', [row('x', 20, 'bigint', {kind: 'view'})]],
    ]);
    const one = {types, tables, schemaVersion: {stage_one: 15, stage_two: 51, stage_three: 6}};
    return {core: one, address: one};
  }
  const haskell = {
    core: new Map([
      [
        'epoch_finalized',
        hsTable('epoch_finalized', [
          ['out_sum', false],
          ['tx_count', false],
        ]),
      ],
    ]),
    address: new Map([
      [
        'epoch_finalized',
        hsTable('epoch_finalized', [
          ['out_sum', false],
          ['tx_count', false],
        ]),
      ],
    ]),
  };

  it('builds the artifact and drops views no record reads', () => {
    const {artifact, problems} = buildArtifact({catalogs: catalogs(catalog()), haskell});
    expect(problems).toEqual([]);
    expect(artifact.schemaVersion).toBe(1);
    expect(artifact.postgres).toBe(17);
    expect(artifact.dbSchemaVersion.stage_two).toBe(51);
    expect(artifact.tables.map((t) => t.name)).toEqual(['epoch_finalized']);
    expect(domainTypedColumns(artifact).map((c) => c.name)).toEqual(['out_sum', 'tx_count']);
  });

  it('changedFingerprints names exactly the columns whose contract moved', () => {
    const before = buildArtifact({catalogs: catalogs(catalog()), haskell}).artifact;
    const after = buildArtifact({catalogs: catalogs(catalog([])), haskell}).artifact;
    expect(changedFingerprints(before, after)).toEqual(['all:epoch_finalized.out_sum']);
    expect(changedFingerprints(before, before)).toEqual([]);
  });
});
