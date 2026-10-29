import {describe, expect, it} from 'vitest';
import {evaluateGuide} from '../../scripts/lib/guide-locks.mjs';

const schema = {
  tables: [{name: 'tx_out', variant: 'all', columns: [{name: 'value', fingerprint: 'old'}]}],
};
const config = {config: {keys: []}};
const guide = (body: string, front = 'requires:\n  columns: [tx_out.value]') =>
  `---\n${front}\n---\n${body}`;

describe('guide locks', () => {
  it('locks declared fingerprints and reports changed ones by guide', () => {
    const first = evaluateGuide('guides/a.md', guide('Uses `tx_out.value`.'), schema, config);
    expect(first.errors).toEqual([]);
    const changed = structuredClone(schema);
    changed.tables[0].columns[0].fingerprint = 'new';
    const result = evaluateGuide(
      'guides/a.md',
      guide('Uses `tx_out.value`.'),
      changed,
      config,
      first.lock,
    );
    expect(JSON.stringify(result.changes)).toContain('old');
    expect(JSON.stringify(result.changes)).toContain('new');
  });
  it('rejects non-existent body columns and override without reason', () => {
    const result = evaluateGuide(
      'a.md',
      guide('Uses `tx_out.missing`.', 'requires:\n  tables: [tx_out]\nrange_override:\n  from: 1'),
      schema,
      config,
    );
    expect(result.errors.join('\n')).toContain('tx_out.missing');
    expect(result.errors.join('\n')).toContain('reason');
  });
  it('warns on undeclared known identifiers in prose and code fences', () => {
    const result = evaluateGuide(
      'a.md',
      guide('`tx_out.value`\n```sql\ntx_out.value\n```', 'requires:\n  tables: [tx_out]'),
      schema,
      config,
    );
    expect(result.warnings.join('\n')).toContain('tx_out.value');
  });
});

it('derives table-to-guide links from both table and column locks', async () => {
  const {guidesForTable} = await import('../../scripts/lib/guide-locks.mjs');
  const locks = {
    guides: {
      'b.md': {'columns:tx_out.value': []},
      'a.md': {'tables:tx_out': 'hash'},
      'c.md': {'tables:tx_in': 'hash'},
    },
  };
  expect(guidesForTable(locks, 'tx_out')).toEqual(['a.md', 'b.md']);
});

it('accepts the documented short config paths when unambiguous', () => {
  const configSchema = {
    config: {
      keys: [
        {
          name: 'insert_options',
          shape: {
            keys: [{name: 'tx_out', shape: {keys: [{name: 'value', shape: {type: 'string'}}]}}],
          },
        },
      ],
    },
  };
  const result = evaluateGuide(
    'a.md',
    guide('', 'requires:\n  config: [tx_out.value]'),
    schema,
    configSchema,
  );
  expect(result.errors).toEqual([]);
});

it('rejects a null range override and never treats it as absent', () => {
  const result = evaluateGuide(
    'a.md',
    guide('', 'requires:\n  columns: [tx_out.value]\nrange_override: null'),
    schema,
    config,
  );
  expect(result.errors.join('\n')).toContain('reason');
});

it('warns on known table and config references missing from requires', () => {
  const configSchema = {config: {keys: [{name: 'Prune', shape: {type: 'boolean'}}]}};
  const result = evaluateGuide(
    'a.md',
    guide('Use `tx_out` and `Prune`.', 'requires:\n  columns: [tx_out.value]'),
    schema,
    configSchema,
  );
  expect(result.warnings.join('\n')).toContain('tx_out');
  expect(result.warnings.join('\n')).toContain('Prune');
});

it('intersects explicit historical entity sets and rejects unknown and disjoint requirements', async () => {
  const {deriveApplicability} = await import('../../scripts/lib/guide-locks.mjs');
  const history = [
    {version: 'v1', entities: ['tables:tx_out', 'columns:tx_out.value']},
    {version: 'v2', entities: ['tables:tx_out', 'columns:tx_out.value', 'columns:tx_out.consumed']},
    {version: 'v3', entities: ['tables:tx_out', 'columns:tx_out.consumed']},
  ];
  expect(deriveApplicability(history, ['tables:tx_out', 'columns:tx_out.consumed'])).toEqual({
    versions: ['v2', 'v3'],
    errors: [],
  });
  expect(deriveApplicability(history, ['columns:tx_out.missing']).errors.join()).toContain(
    'unknown',
  );
  expect(
    deriveApplicability(history, [
      'columns:tx_out.value',
      'columns:tx_out.consumed',
      'tables:missing',
    ]).errors.join(),
  ).toContain('unknown');
  expect(
    deriveApplicability(
      [
        {version: 'v1', entities: ['a']},
        {version: 'v2', entities: ['b']},
      ],
      ['a', 'b'],
    ).errors.join(),
  ).toContain('intersection');
});

it('reports the changed column contract alongside its fingerprint', () => {
  const withContract = {
    tables: [
      {
        name: 'tx_out',
        variant: 'all',
        columns: [
          {
            name: 'value',
            fingerprint: 'old',
            resolved_type: {base: 'integer', domains: [], checks: [], not_null: false},
            nullable: true,
            default: null,
          },
        ],
      },
    ],
  };
  const first = evaluateGuide('a.md', guide(''), withContract, config);
  const changed = structuredClone(withContract);
  changed.tables[0].columns[0].fingerprint = 'new';
  changed.tables[0].columns[0].nullable = false;
  const result = evaluateGuide('a.md', guide(''), changed, config, first.lock);
  expect(JSON.stringify(result.changes)).toContain('"nullable":true');
  expect(JSON.stringify(result.changes)).toContain('"nullable":false');
});

it('intersects generated historical sets without inventing versions', async () => {
  const {deriveApplicability} = await import('../../scripts/lib/guide-locks.mjs');
  let seed = 7123;
  const next = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed;
  };
  for (let iteration = 0; iteration < 150; iteration++) {
    const entities = ['a', 'b', 'c', 'd'];
    const history = Array.from({length: 8}, (_, i) => ({
      version: `v${i}`,
      entities: entities.filter(() => (next() & 4) !== 0),
    }));
    const required = entities.filter(() => (next() & 8) !== 0);
    const actual = deriveApplicability(history, required);
    const expected = history
      .filter((row) => required.every((id) => row.entities.includes(id)))
      .map((row) => row.version);
    expect(actual.versions).toEqual(expected);
    expect(actual.errors.length === 0).toBe(expected.length > 0);
  }
});

it('allows a reasoned override only inside the real entity intersection', async () => {
  const {resolveGuideRange} = await import('../../scripts/lib/guide-locks.mjs');
  const history = [
    {version: 'old', entities: ['columns:tx_out.removed']},
    {version: 'new', entities: []},
  ];
  expect(
    resolveGuideRange(history, ['columns:tx_out.removed'], {
      versions: ['old'],
      reason: 'Documents removed behaviour',
    }),
  ).toEqual({versions: ['old'], errors: []});
  expect(
    resolveGuideRange(history, ['columns:tx_out.removed'], {
      versions: ['new'],
      reason: 'x',
    }).errors.join(),
  ).toContain('outside');
  expect(
    resolveGuideRange(history, ['columns:tx_out.removed'], {versions: ['old']}).errors.join(),
  ).toContain('reason');
  expect(
    resolveGuideRange(history, ['columns:tx_out.missing'], {
      versions: ['old'],
      reason: 'x',
    }).errors.join(),
  ).toContain('unknown');
});

it('explains renamed entities instead of silently accepting a stale declaration', () => {
  const renamed = {
    entities: [{kind: 'column', table: 'tx_out', name: 'value', formerNames: [{name: 'amount'}]}],
  };
  const result = evaluateGuide(
    'a.md',
    guide('', 'requires:\n  columns: [tx_out.amount]'),
    schema,
    config,
    undefined,
    renamed,
  );
  expect(result.errors.join('\n')).toContain('tx_out.amount');
  expect(result.errors.join('\n')).toContain('tx_out.value');
  expect(result.errors.join('\n')).toContain('rename');
});

it('derives the actual release range and locks the last applicable historical contract', async () => {
  const {evaluateHistoricalGuide} = await import('../../scripts/lib/guide-locks.mjs');
  const history = [
    {tag: 'old', schema, config},
    {tag: 'new', schema: {tables: [{...schema.tables[0], columns: []}]}, config},
  ];
  const source = guide('', 'requires:\n  columns: [tx_out.value]');
  const result = evaluateHistoricalGuide('a.md', source, history);
  expect(result.errors).toEqual([]);
  expect(result.versions).toEqual(['old']);
  expect(Object.keys(result.lock)).toContain('columns:tx_out.value');
  expect(evaluateHistoricalGuide('a.md', source, []).errors.join()).toContain('history');
});

it('rejects manually widening a historically derived range or hiding an unknown entity', async () => {
  const {evaluateHistoricalGuide} = await import('../../scripts/lib/guide-locks.mjs');
  const history = [
    {tag: 'old', schema, config},
    {tag: 'new', schema: {tables: [{...schema.tables[0], columns: []}]}, config},
  ];
  const source = guide(
    '',
    'requires:\n  columns: [tx_out.value]\nrange_override:\n  versions: [new]\n  reason: attempt to widen',
  );
  expect(evaluateHistoricalGuide('a.md', source, history).errors.join()).toContain('outside');
});

it('requires a reasoned override for a dependency removed from the current schema', async () => {
  const {evaluateHistoricalGuide} = await import('../../scripts/lib/guide-locks.mjs');
  const history = [
    {tag: 'old', schema, config},
    {tag: 'current', schema: {tables: [{...schema.tables[0], columns: []}]}, config},
  ];
  expect(evaluateHistoricalGuide('a.md', guide(''), history).errors.join()).toContain('override');
  const source = guide(
    '',
    'requires:\n  columns: [tx_out.value]\nrange_override:\n  versions: [old]\n  reason: Documents removed behaviour',
  );
  expect(evaluateHistoricalGuide('a.md', source, history).errors).toEqual([]);
});

it('ignores source coordinates and object key order when fingerprinting config', () => {
  const conf1 = {
    config: {
      keys: [
        {
          name: 'flag',
          required: false,
          shape: {type: 'object', haskell: 'Flag', keys: [], line: 12},
        },
      ],
    },
  };
  const conf2 = {
    config: {
      keys: [
        {
          shape: {line: 99, keys: [], haskell: 'Flag', type: 'object'},
          required: false,
          name: 'flag',
        },
      ],
    },
  };
  const source = guide('', 'requires:\n  config: [flag]');
  const first = evaluateGuide('a.md', source, schema, conf1);
  expect(evaluateGuide('a.md', source, schema, conf2, first.lock).changes).toEqual([]);
});

it('exposes the same derived versions through the browser-safe guide data layer', async () => {
  const {versionsForGuide} = await import('../../src/data/guide-locks.mjs');
  expect(versionsForGuide({ranges: {'a.md': ['v1', 'v2']}}, 'a.md')).toEqual(['v1', 'v2']);
  expect(versionsForGuide({ranges: {}}, 'missing.md')).toEqual([]);
});

it('rejects hand-typed support ranges outside the reasoned override', () => {
  const result = evaluateGuide(
    'a.md',
    guide('', 'requires:\n  tables: [tx_out]\nschema_range: 0048+'),
    schema,
    config,
  );
  expect(result.errors.join('\n')).toContain('derived');
});

it('rejects malformed qualified column identifiers', () => {
  for (const id of ['tx_out.value.', 'tx_out..value', 'tx_out.value.extra']) {
    const result = evaluateGuide(
      'a.md',
      guide('', `requires:\n  columns: ['${id}']`),
      schema,
      config,
    );
    expect(result.errors.length).toBeGreaterThan(0);
  }
});

it('rejects unrecognised override attributes rather than ignoring author intent', async () => {
  const {resolveGuideRange} = await import('../../scripts/lib/guide-locks.mjs');
  const result = resolveGuideRange([{version: 'v1', entities: ['x']}], ['x'], {
    versions: ['v1'],
    reason: 'test',
    from: 'old',
  });
  expect(result.errors.length).toBeGreaterThan(0);
});

it('does not invalidate a declared column when another column is added', () => {
  const source = guide('');
  const reviewed = evaluateGuide('a.md', source, schema, config);
  const updated = structuredClone(schema);
  updated.tables[0].columns.push({name: 'unrelated', fingerprint: 'new'});
  expect(evaluateGuide('a.md', source, updated, config, reviewed.lock).changes).toEqual([]);
});

it.each([
  [true, false],
  [false, true],
])('reports nullability changes in both directions %s to %s', (before, after) => {
  const original = {
    tables: [
      {
        name: 'tx_out',
        variant: 'core',
        columns: [{name: 'value', fingerprint: 'prior', nullable: before}],
      },
    ],
  };
  const changed = structuredClone(original);
  changed.tables[0].columns[0].nullable = after;
  changed.tables[0].columns[0].fingerprint = 'next';
  const lock = evaluateGuide('a.md', guide(''), original, config).lock;
  expect(evaluateGuide('a.md', guide(''), changed, config, lock).changes).toHaveLength(1);
});

it('names a renamed current entity when an old guide needs review', async () => {
  const {evaluateHistoricalGuide} = await import('../../scripts/lib/guide-locks.mjs');
  const oldSchema = {
    tables: [{name: 'tx_out', variant: 'core', columns: [{name: 'amount', fingerprint: 'old'}]}],
  };
  const currentSchema = {
    tables: [{name: 'tx_out', variant: 'core', columns: [{name: 'value', fingerprint: 'new'}]}],
  };
  const history = [
    {tag: 'old', schema: oldSchema, config},
    {tag: 'current', schema: currentSchema, config},
  ];
  const source = guide('', 'requires:\n  columns: [tx_out.amount]');
  const renames = {
    entities: [{kind: 'column', table: 'tx_out', name: 'value', formerNames: [{name: 'amount'}]}],
  };
  const reviewed = evaluateGuide('a.md', source, oldSchema, config).lock;
  const result = evaluateHistoricalGuide('a.md', source, history, reviewed, renames);
  expect(result.errors.join('\n')).toContain('tx_out.value');
  expect(result.changes).toHaveLength(1);
});

it('treats a configuration default named line as data, not a source coordinate', () => {
  const first = {
    config: {
      keys: [
        {
          name: 'output',
          default: {line: 1},
          required: false,
          shape: {type: 'object', haskell: 'Output', keys: [], line: 10},
        },
      ],
    },
  };
  const changed = {
    config: {
      keys: [
        {
          name: 'output',
          default: {line: 2},
          required: false,
          shape: {type: 'object', haskell: 'Output', keys: [], line: 10},
        },
      ],
    },
  };
  const source = guide('', 'requires:\n  config: [output]');
  const lock = evaluateGuide('a.md', source, schema, first).lock;
  expect(evaluateGuide('a.md', source, schema, changed, lock).changes).toHaveLength(1);
});

it('rejects a nonexistent qualified column in a SQL code fence', () => {
  const result = evaluateGuide(
    'a.md',
    guide('```sql\nSELECT tx_out.missing FROM tx_out;\n```', 'requires:\n  tables: [tx_out]'),
    schema,
    config,
  );
  expect(result.errors.join('\n')).toContain('tx_out.missing');
});

it('does not confuse a valid tx_out config path with a nonexistent database column', () => {
  const cfg = {
    config: {
      keys: [
        {
          name: 'insert_options',
          shape: {
            keys: [
              {name: 'tx_out', shape: {keys: [{name: 'force_tx_in', shape: {type: 'boolean'}}]}},
            ],
          },
        },
      ],
    },
  };
  const result = evaluateGuide(
    'a.md',
    guide('Set `tx_out.force_tx_in`.', 'requires:\n  config: [tx_out.force_tx_in]'),
    schema,
    cfg,
  );
  expect(result.errors).toEqual([]);
});

it('shows actual old and new config values in drift details', () => {
  const first = {
    config: {keys: [{name: 'flag', default: false, required: false, shape: {type: 'boolean'}}]},
  };
  const next = {
    config: {keys: [{name: 'flag', default: true, required: false, shape: {type: 'boolean'}}]},
  };
  const source = guide('', 'requires:\n  config: [flag]');
  const lock = evaluateGuide('a.md', source, schema, first).lock;
  const changes = JSON.stringify(evaluateGuide('a.md', source, schema, next, lock).changes);
  expect(changes).toContain('"default":false');
  expect(changes).toContain('"default":true');
});

it('does not mistake a markdown link destination for a database column claim', () => {
  const result = evaluateGuide(
    'a.md',
    guide('See [export](https://example.test/tx_out.json).', 'requires:\n  tables: [tx_out]'),
    schema,
    config,
  );
  expect(result.errors).toEqual([]);
});

it('explains known renames even when no retained release contains the former name', async () => {
  const {evaluateHistoricalGuide} = await import('../../scripts/lib/guide-locks.mjs');
  const history = [{tag: 'current', schema, config}];
  const renames = {
    entities: [{kind: 'column', table: 'tx_out', name: 'value', formerNames: [{name: 'amount'}]}],
  };
  const result = evaluateHistoricalGuide(
    'a.md',
    guide('', 'requires:\n  columns: [tx_out.amount]'),
    history,
    undefined,
    renames,
  );
  expect(result.errors.join('\n')).toContain('renamed to tx_out.value');
});

it('validates public-schema-qualified column references', () => {
  const result = evaluateGuide(
    'a.md',
    guide(
      '```sql\nSELECT public.tx_out.missing FROM public.tx_out;\n```',
      'requires:\n  tables: [tx_out]',
    ),
    schema,
    config,
  );
  expect(result.errors.join('\n')).toContain('tx_out.missing');
});

it('fails closed on malformed guide metadata, ambiguous config and invalid history', async () => {
  const {evaluateHistoricalGuide, deriveApplicability, resolveGuideRange} =
    await import('../../scripts/lib/guide-locks.mjs');
  for (const source of [
    'No frontmatter',
    '---\nrequires: [\n---\n',
    '---\n- array\n---\n',
    '---\ntitle: no-requires\n---\n',
    '---\nrequires:\n  unknown: [x]\n---\n',
  ]) {
    expect(evaluateGuide('a.md', source, schema, config).errors.length).toBeGreaterThan(0);
    expect(
      evaluateHistoricalGuide('a.md', source, [{tag: 'current', schema, config}]).errors.length,
    ).toBeGreaterThan(0);
  }
  expect(
    evaluateGuide(
      'a.md',
      guide('', 'requires:\n  tables: [tx_out, tx_out]'),
      schema,
      config,
    ).errors.join(),
  ).toContain('duplicate');
  const ambiguous = {
    config: {
      keys: [
        {name: 'a', shape: {keys: [{name: 'value', shape: {type: 'string'}}]}},
        {name: 'b', shape: {keys: [{name: 'value', shape: {type: 'string'}}]}},
      ],
    },
  };
  expect(
    evaluateGuide(
      'a.md',
      guide('', 'requires:\n  config: [value]'),
      schema,
      ambiguous,
    ).errors.join(),
  ).toContain('ambiguous');
  expect(deriveApplicability([], []).errors.length).toBeGreaterThan(0);
  expect(deriveApplicability([{version: 'v1', entities: []}], ['']).errors.length).toBeGreaterThan(
    0,
  );
  expect(
    deriveApplicability(
      [
        {version: 'v1', entities: []},
        {version: 'v1', entities: []},
      ],
      [],
    ).errors.length,
  ).toBeGreaterThan(0);
  expect(
    resolveGuideRange([{version: 'v1', entities: ['x']}], ['x'], {
      versions: ['v1', 'v1'],
      reason: 'x',
    }).errors.length,
  ).toBeGreaterThan(0);
});

it('warns about unqualified columns only when their table is unambiguous', () => {
  const sample = {
    tables: [
      {
        name: 'tx_out',
        variant: 'core',
        columns: [
          {name: 'unique_field', fingerprint: 'x'},
          {name: 'id', fingerprint: 'y'},
        ],
      },
      {name: 'tx_in', variant: 'core', columns: [{name: 'id', fingerprint: 'z'}]},
    ],
  };
  const source = guide('Use unique_field and `id`.', 'requires:\n  tables: [tx_out]');
  const result = evaluateGuide('a.md', source, sample, config);
  expect(result.warnings.join('\n')).toContain('tx_out.unique_field');
  expect(result.warnings.join('\n')).not.toContain('tx_out.id');
  expect(result.warnings.join('\n')).not.toContain('tx_in.id');
});

it('does not warn when an unqualified unique column is declared, even across variants', () => {
  const sample = {
    tables: [
      {name: 'tx_out', variant: 'core', columns: [{name: 'unique_field', fingerprint: 'x'}]},
      {name: 'tx_out', variant: 'address', columns: [{name: 'unique_field', fingerprint: 'y'}]},
    ],
  };
  const result = evaluateGuide(
    'a.md',
    guide('Use unique_field.', 'requires:\n  columns: [tx_out.unique_field]'),
    sample,
    config,
  );
  expect(result.warnings).toEqual([]);
});

it('still warns when a name is both a declared config key and an undeclared column', () => {
  const cfg = {
    config: {keys: [{name: 'tx_out', shape: {keys: [{name: 'value', shape: {type: 'string'}}]}}]},
  };
  const result = evaluateGuide(
    'a.md',
    guide('`tx_out.value`', 'requires:\n  config: [tx_out.value]'),
    schema,
    cfg,
  );
  expect(result.warnings.join('\n')).toContain('undeclared column tx_out.value');
});
