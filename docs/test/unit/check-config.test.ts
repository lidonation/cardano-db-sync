import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {afterEach, beforeEach, describe, expect, it} from 'vitest';

import {EXAMPLE_CONFIGS, WIZARD_DIR, findProblems, main} from '../../scripts/check-config.mjs';
import type {ConfigSchema} from '../../src/data/config-schema.mjs';
import {
  findSchemaProblems,
  listOptions,
  presetValues,
  validateConfig,
} from '../../src/data/config-schema.mjs';
import {
  configOptions,
  insertPreset,
  loadConfigSchema,
  validateWizardOutput,
} from '../../src/data/dbsync-config';

const DOCS_ROOT = path.resolve(import.meta.dirname, '../..');

/**
 * A small schema in the artifact's shape — the tests break it or feed it configs one way at a
 * time. Mirrors the idioms the extractor reads: a required top-level key, defaults, an enum, a
 * nested object with a required key, a nullable integer and a preset.
 */
function schema(overrides: Partial<ConfigSchema> = {}): ConfigSchema {
  return {
    schemaVersion: 2,
    sources: ['cardano-db-sync/src/Cardano/DbSync/Config/Types.hs'],
    root: 'SyncPreConfig',
    config: {
      type: 'object',
      haskell: 'SyncPreConfig',
      line: 441,
      keys: [
        {name: 'NetworkName', required: true, shape: {type: 'string'}},
        {name: 'EnableLogging', required: true, shape: {type: 'boolean'}},
        {name: 'PrometheusPort', required: false, shape: {type: 'integer'}, default: 8080},
        {name: 'ipfs_gateway', required: false, shape: {type: 'array', items: {type: 'string'}}},
        {
          name: 'ledger_backend',
          required: false,
          shape: {type: 'enum', values: ['inmemory', 'lsm']},
          default: 'inmemory',
        },
        {
          name: 'insert_options',
          required: false,
          shape: {
            type: 'object',
            haskell: 'SyncInsertConfig',
            line: 479,
            keys: [
              {
                name: 'preset',
                required: false,
                shape: {type: 'enum', values: ['full', 'only_utxo'], nullable: true},
              },
              {
                name: 'tx_out',
                required: false,
                shape: {
                  type: 'object',
                  haskell: 'TxOutConfig',
                  line: 629,
                  keys: [
                    {
                      name: 'value',
                      required: true,
                      shape: {type: 'enum', values: ['enable', 'disable', 'prune']},
                    },
                    {
                      name: 'force_tx_in',
                      required: false,
                      shape: {type: 'boolean'},
                      default: false,
                    },
                  ],
                },
              },
              {
                name: 'stop_at_block',
                required: false,
                shape: {type: 'integer', nullable: true},
                default: null,
              },
              {name: 'genesis_hash', required: false, shape: {type: 'string'}},
            ],
            presets: [
              {
                key: 'preset',
                values: {full: {stop_at_block: null}, only_utxo: {stop_at_block: 123}},
              },
            ],
          },
        },
      ],
    },
    passthrough: [{keys: ['TraceOptions', 'Options'], reader: 'readTraceConfig'}],
    unresolved: [],
    ...overrides,
  };
}

const FULL = {NetworkName: 'mainnet', EnableLogging: true};

describe('validateConfig (CON-4)', () => {
  it('accepts a config that only uses options db-sync reads', () => {
    expect(
      validateConfig(schema(), {
        ...FULL,
        PrometheusPort: 8080,
        ipfs_gateway: ['https://ipfs.io/ipfs'],
        ledger_backend: 'lsm',
        TraceOptions: {'': {severity: 'Info'}},
        insert_options: {
          preset: 'only_utxo',
          tx_out: {value: 'prune', force_tx_in: true},
          stop_at_block: null,
          genesis_hash: 'abc',
        },
      }),
    ).toEqual([]);
  });

  it('names an invented option, with the options its object does accept', () => {
    expect(validateConfig(schema(), {...FULL, insert_options: {tx_cbor_v2: 'enable'}})).toEqual([
      'insert_options.tx_cbor_v2: not an option db-sync reads — SyncInsertConfig accepts preset, tx_out, stop_at_block, genesis_hash',
    ]);
  });

  it('rejects a value outside an enum', () => {
    expect(validateConfig(schema(), {...FULL, ledger_backend: 'rocksdb'})).toEqual([
      'ledger_backend: "rocksdb" is not one of inmemory, lsm',
    ]);
  });

  it('reports missing required keys, but not at the root of a fragment', () => {
    expect(validateConfig(schema(), {})).toEqual([
      'NetworkName: required by SyncPreConfig',
      'EnableLogging: required by SyncPreConfig',
    ]);
    expect(validateConfig(schema(), {insert_options: {}}, {fragment: true})).toEqual([]);
    // a nested object's required key is required even in a fragment
    expect(
      validateConfig(schema(), {insert_options: {tx_out: {force_tx_in: true}}}, {fragment: true}),
    ).toEqual(['insert_options.tx_out.value: required by TxOutConfig']);
  });

  it('checks every scalar and container shape', () => {
    const problems = validateConfig(schema(), {
      NetworkName: 7,
      EnableLogging: 'yes',
      PrometheusPort: 80.5,
      ipfs_gateway: ['ok', 3],
      ledger_backend: null,
      insert_options: {tx_out: 'prune', stop_at_block: null},
    });
    expect(problems).toEqual([
      'NetworkName: expected a string, got 7',
      'EnableLogging: expected true or false, got "yes"',
      'PrometheusPort: expected a safe integer, got 80.5',
      'ipfs_gateway[1]: expected a string, got 3',
      'ledger_backend: null is not accepted',
      'insert_options.tx_out: expected an object (TxOutConfig), got "prune"',
    ]);
    expect(validateConfig(schema(), {...FULL, ipfs_gateway: 'x'})).toEqual([
      'ipfs_gateway: expected a list, got "x"',
    ]);
    expect(validateConfig(schema(), ['a'])).toEqual([
      '(config root): expected an object (SyncPreConfig), got a list',
    ]);
    expect(validateConfig(schema(), {...FULL, insert_options: {tx_out: {value: {}}}})).toEqual([
      'insert_options.tx_out.value: an object is not one of enable, disable, prune',
    ]);
  });

  it('treats passthrough keys as known only at the root', () => {
    expect(validateConfig(schema(), {...FULL, insert_options: {TraceOptions: {}}})).toHaveLength(1);
  });

  it('refuses a shape type it does not know', () => {
    const odd = schema();
    odd.config.keys.push({name: 'x', required: false, shape: {type: 'tuple'} as never});
    expect(validateConfig(odd, {...FULL, x: 1})).toEqual([
      'config.x: unsupported shape type "tuple"',
    ]);
  });
});

describe('listOptions and presetValues', () => {
  it('lists every option as a dotted path in source order', () => {
    expect(listOptions(schema()).map((o) => o.path)).toEqual([
      'NetworkName',
      'EnableLogging',
      'PrometheusPort',
      'ipfs_gateway',
      'ledger_backend',
      'insert_options',
      'insert_options.preset',
      'insert_options.tx_out',
      'insert_options.tx_out.value',
      'insert_options.tx_out.force_tx_in',
      'insert_options.stop_at_block',
      'insert_options.genesis_hash',
    ]);
  });

  it('returns what a preset switches on, and nothing for a non-preset path or value', () => {
    expect(presetValues(schema(), 'insert_options.preset', 'only_utxo')).toEqual({
      stop_at_block: 123,
    });
    expect(presetValues(schema(), 'insert_options.preset', 'nope')).toBeUndefined();
    expect(presetValues(schema(), 'insert_options.tx_out', 'x')).toBeUndefined();
    expect(presetValues(schema(), 'missing.preset', 'full')).toBeUndefined();
    expect(presetValues(schema(), 'ledger_backend.preset', 'full')).toBeUndefined();
  });
});

describe('the committed schema', () => {
  it('loads, and every top-level key the example configs use is in it', () => {
    const s = loadConfigSchema();
    expect(s.unresolved).toEqual([]);
    const known = new Set([
      ...s.config.keys.map((k) => k.name),
      ...s.passthrough.flatMap((p) => p.keys),
    ]);
    for (const key of [
      'NetworkName',
      'EnableLogMetrics',
      'EnableLogging',
      'NodeConfigFile',
      'TraceOptions',
    ]) {
      expect(known).toContain(key);
    }
    expect(configOptions().length).toBeGreaterThan(s.config.keys.length);
  });

  it('refuses an artifact of another version', () => {
    expect(() => loadConfigSchema({...schema(), schemaVersion: 3})).toThrow(/version 3/);
  });

  it('exposes the insert_options presets and validates wizard output against them', () => {
    for (const preset of ['full', 'only_utxo', 'only_governance', 'disable_all']) {
      expect(insertPreset(preset)).toBeDefined();
    }
    expect(validateWizardOutput({insert_options: {preset: 'full'}})).toEqual([]);
    expect(validateWizardOutput({insert_options: {preset: 'everything'}})).toHaveLength(1);
  });
});

describe('config schema safety regressions', () => {
  it('rejects malformed schemas before config values are inspected', () => {
    for (const invalid of [
      null,
      [],
      {},
      {...schema(), sources: []},
      {...schema(), sources: ['../outside.hs']},
      {...schema(), config: {...schema().config, keys: []}},
      {...schema(), passthrough: [{keys: [null], reader: 'reader'}]},
    ]) {
      expect(findSchemaProblems(invalid).length).toBeGreaterThan(0);
      expect(() => loadConfigSchema(invalid)).toThrow(/schema/);
    }
    const duplicate = schema();
    duplicate.config.keys.push(duplicate.config.keys[0]);
    expect(findSchemaProblems(duplicate).join('\n')).toContain('duplicate key NetworkName');
    const emptyEnum = schema();
    emptyEnum.config.keys.push({name: 'empty', required: false, shape: {type: 'enum', values: []}});
    expect(findSchemaProblems(emptyEnum).join('\n')).toContain('enum values');
  });

  it('checks bounded numbers and does not round unsafe integers', () => {
    const s = schema();
    s.config.keys.push({
      name: 'word',
      required: false,
      shape: {type: 'integer', haskell: 'Word8', minimum: '0', maximum: '255'},
    });
    expect(validateConfig(s, {...FULL, word: 0})).toEqual([]);
    expect(validateConfig(s, {...FULL, word: 255})).toEqual([]);
    for (const word of [-1, 256])
      expect(validateConfig(s, {...FULL, word})[0]).toContain('outside Word8 bounds');
    expect(validateConfig(s, {...FULL, word: Number.MAX_SAFE_INTEGER + 1})[0]).toContain(
      'safe integer',
    );
  });

  it('rejects empty NonEmpty config lists and unsigned negatives in the real schema', () => {
    for (const name of ['metadata', 'shelley', 'multi_asset', 'plutus']) {
      const key = {
        metadata: 'keys',
        shelley: 'stake_addresses',
        multi_asset: 'policies',
        plutus: 'script_hashes',
      }[name];
      const errors = validateWizardOutput({insert_options: {[name]: {enable: true, [key!]: []}}});
      expect(errors[0]).toContain('expected at least 1');
    }
    expect(validateWizardOutput({insert_options: {stop_at_block: -1}})[0]).toContain(
      'outside Word64 bounds',
    );
    expect(validateWizardOutput({snapshot_interval: {near_tip_epoch: -1}})[0]).toContain(
      'outside Word64 bounds',
    );
  });

  it('validates selection values and rejects the retired JSON selector', () => {
    const policy = 'ab'.repeat(28);
    const stake = 'stake_test1uz7nhfssw7e2p8pr4hwvlsv9x920famnd5ngz42zpk7rh2q3rg0ut';
    expect(
      validateWizardOutput({insert_options: {multi_asset: {enable: true, policies: [policy]}}}),
    ).toEqual([]);
    expect(
      validateWizardOutput({insert_options: {plutus: {enable: true, script_hashes: [policy]}}}),
    ).toEqual([]);
    expect(
      validateWizardOutput({insert_options: {shelley: {enable: true, stake_addresses: [stake]}}}),
    ).toEqual([]);
    expect(
      validateWizardOutput({insert_options: {multi_asset: {enable: true, policies: ['bad']}}}).join(
        ' ',
      ),
    ).toContain('28-byte');
    expect(
      validateWizardOutput({insert_options: {plutus: {enable: true, script_hashes: ['bad']}}}).join(
        ' ',
      ),
    ).toContain('28-byte');
    expect(
      validateWizardOutput({
        insert_options: {shelley: {enable: true, stake_addresses: ['not-an-address']}},
      }).join(' '),
    ).toContain('bech32');
    expect(validateWizardOutput({insert_options: {json_type: 'disable'}}).join(' ')).toContain(
      'json_type',
    );
  });

  it('validates bounded generated policy hashes and disabled-selection overrides', () => {
    let state = 121;
    const next = () => (state = (state * 1664525 + 1013904223) >>> 0) & 255;
    for (let i = 0; i < 64; i++) {
      const hash = Array.from({length: 28}, () => next().toString(16).padStart(2, '0')).join('');
      expect(
        validateWizardOutput({insert_options: {multi_asset: {enable: true, policies: [hash]}}}),
      ).toEqual([]);
      expect(
        validateWizardOutput({
          insert_options: {plutus: {enable: true, script_hashes: [hash.slice(1)]}},
        }).join(' '),
      ).toContain('28-byte');
    }
    expect(
      validateWizardOutput({insert_options: {multi_asset: {enable: false, policies: ['ignored']}}}),
    ).toEqual([]);
    expect(
      validateWizardOutput({insert_options: {plutus: {enable: false, script_hashes: ['ignored']}}}),
    ).toEqual([]);
    expect(
      validateWizardOutput({
        insert_options: {shelley: {enable: false, stake_addresses: ['ignored']}},
      }),
    ).toEqual([]);
    expect(
      validateWizardOutput({
        insert_options: {
          shelley: {
            enable: true,
            stake_addresses: ['stake_test1uz7nhfssw7e2p8pr4hwvlsv9x920famnd5ngz42zpk7rh2q3rg0ux'],
          },
        },
      }).join(' '),
    ).toContain('bech32');
  });

  it('does not apply selection rules to unrelated same-named fields', () => {
    const s = schema();
    s.config.keys.push({
      name: 'other',
      required: false,
      shape: {
        type: 'object',
        haskell: 'Other',
        line: 1,
        keys: [{name: 'policies', required: true, shape: {type: 'array', items: {type: 'string'}}}],
      },
    });
    expect(validateConfig(s, {...FULL, other: {policies: ['not-a-hash']}})).toEqual([]);
  });

  it('accepts explicit null for optional .:? keys, including defaulted ones', () => {
    for (const output of [
      {insert_options: null},
      {insert_options: {preset: null}},
      {insert_options: {tx_out: {value: 'enable', force_tx_in: null}}},
      {insert_options: {metadata: {enable: true, keys: null}}},
      {PrometheusPort: null},
    ])
      expect(validateWizardOutput(output)).toEqual([]);
    expect(validateWizardOutput({insert_options: {metadata: {enable: null}}})[0]).toContain(
      'null is not accepted',
    );
  });

  it('does not use inherited values as presets or mutate preset defaults through its result', () => {
    for (const name of ['toString', '__proto__', 'constructor'])
      expect(insertPreset(name)).toBeUndefined();
    const preset = insertPreset('full')!;
    preset.governance = 'disable';
    (preset.tx_out as Record<string, unknown>).value = 'disable';
    expect(insertPreset('full')!.governance).toBe('enable');
    expect((insertPreset('full')!.tx_out as Record<string, unknown>).value).toBe('enable');
  });

  it('requires own required config keys', () => {
    const inherited = Object.create(FULL) as Record<string, unknown>;
    expect(validateConfig(schema(), inherited)).toEqual([
      'NetworkName: required by SyncPreConfig',
      'EnableLogging: required by SyncPreConfig',
    ]);
  });

  it('validates preset entries and defaults against their option shapes', () => {
    const s = schema();
    s.config.keys[2].default = 'not a number';
    expect(findSchemaProblems(s).join('\n')).toContain('PrometheusPort default');
    const invalid = schema();
    const insert = invalid.config.keys.find((k) => k.name === 'insert_options')!
      .shape as import('../../src/data/config-schema.mjs').ConfigObjectShape;
    insert.presets![0].values.full = {unknown: true};
    expect(findSchemaProblems(invalid).join('\n')).toContain('unknown sibling unknown');
  });
});

let repo: string;
let docs: string;

beforeEach(async () => {
  repo = await fs.mkdtemp(path.join(os.tmpdir(), 'dbsync-config-'));
  docs = path.join(repo, 'docs');
  await fs.mkdir(path.join(docs, 'generated'), {recursive: true});
  await fs.mkdir(path.join(docs, WIZARD_DIR), {recursive: true});
  await fs.mkdir(path.join(repo, 'config'), {recursive: true});
  await fs.mkdir(path.join(repo, 'cardano-db-sync/src/Cardano/DbSync/Config'), {recursive: true});
  await fs.writeFile(path.join(repo, 'cardano-db-sync/src/Cardano/DbSync/Config/Types.hs'), '');
});

afterEach(async () => {
  await fs.rm(repo, {recursive: true, force: true});
});

async function writeTree({
  artifact = schema() as unknown,
  examples = 'NetworkName: mainnet\nEnableLogging: True\nTraceOptions:\n  "":\n    severity: Info\n',
  wizard = {'step1.json': '{"insert_options": {"preset": "full"}}'} as Record<string, string>,
} = {}) {
  await fs.writeFile(
    path.join(docs, 'generated/config-schema.json'),
    typeof artifact === 'string' ? artifact : JSON.stringify(artifact),
  );
  for (const file of EXAMPLE_CONFIGS) await fs.writeFile(path.join(repo, file), examples);
  for (const [name, body] of Object.entries(wizard)) {
    await fs.writeFile(path.join(docs, WIZARD_DIR, name), body);
  }
}

const quiet = {log: () => {}, error: () => {}};

describe('check:config gate (CON-4)', () => {
  it('passes over the real tree', async () => {
    expect(findProblems(DOCS_ROOT)).toEqual([]);
    const lines: string[] = [];
    expect(await main(DOCS_ROOT, {log: (l: string) => lines.push(l), error: () => {}})).toBe(0);
    expect(lines[0]).toMatch(/^check:config — schema 2 \(SyncPreConfig\)/);
  });

  it('passes over a sound synthetic tree', async () => {
    await writeTree();
    expect(findProblems(docs)).toEqual([]);
  });

  it('fails, naming it, when the wizard emits an invented option (seeded mismatch)', async () => {
    await writeTree({wizard: {'result.json': '{"insert_options": {"tx_cbor_v2": "enable"}}'}});
    const errors: string[] = [];
    expect(await main(docs, {log: () => {}, error: (l: string) => errors.push(l)})).toBe(1);
    expect(errors.join('\n')).toContain(
      `${WIZARD_DIR}/result.json: insert_options.tx_cbor_v2: not an option db-sync reads`,
    );
  });

  it('fails when the wizard emits a value the binary rejects', async () => {
    await writeTree({wizard: {'r.json': '{"insert_options": {"tx_out": {"value": "pruned"}}}'}});
    expect(findProblems(docs)).toEqual([
      `${WIZARD_DIR}/r.json: insert_options.tx_out.value: "pruned" is not one of enable, disable, prune`,
    ]);
  });

  it('fails when a shipped example config uses a key db-sync does not read', async () => {
    await writeTree({examples: 'NetworkName: x\nEnableLogging: true\nRequiresNetworkMagic: R\n'});
    const problems = findProblems(docs);
    expect(problems).toHaveLength(EXAMPLE_CONFIGS.length);
    expect(problems[0]).toMatch(
      /^config\/mainnet-config\.yaml: RequiresNetworkMagic: not an option/,
    );
  });

  it('reads YAML booleans the way db-sync does (True is true)', async () => {
    await writeTree({examples: 'NetworkName: x\nEnableLogging: True\n'});
    expect(findProblems(docs)).toEqual([]);
  });

  it('fails on unreadable inputs and an unsound schema', async () => {
    expect(findProblems(docs)).toEqual([
      'generated/config-schema.json is missing — run the extract-haddock workflow',
    ]);
    await writeTree({artifact: '{oops'});
    expect(findProblems(docs)[0]).toMatch(/^generated\/config-schema\.json is not valid JSON/);
    await writeTree({
      artifact: {...schema(), schemaVersion: 9, unresolved: ['key x'], sources: ['nope.hs']},
      examples: ': : :\n  - [',
      wizard: {'bad.json': '{'},
    });
    const problems = findProblems(docs);
    expect(problems).toEqual([
      'schema version 9 is not 2',
      'the schema has parts the extractor could not read: ["key x"]',
    ]);
    await writeTree({examples: ': : :\n  - [', wizard: {'bad.json': '{'}});
    const inputProblems = findProblems(docs);
    expect(
      inputProblems.some((p) => p.startsWith('config/mainnet-config.yaml: not valid YAML')),
    ).toBe(true);
    expect(inputProblems.some((p) => p.startsWith(`${WIZARD_DIR}/bad.json: not valid JSON`))).toBe(
      true,
    );
  });

  it('fails when the schema root or passthrough list is malformed', async () => {
    await writeTree({artifact: {...schema(), config: {type: 'enum'}}});
    expect(findProblems(docs)).toEqual(['the schema root must be an object with keys']);
    await writeTree({artifact: {...schema(), passthrough: null}});
    expect(findProblems(docs)).toEqual(['passthrough must be an array']);
  });

  it('fails when an example config is missing or there is no wizard output to check', async () => {
    await writeTree({wizard: {}});
    await fs.rm(path.join(repo, EXAMPLE_CONFIGS[1]));
    expect(findProblems(docs)).toEqual([
      `${EXAMPLE_CONFIGS[1]}: missing`,
      `${WIZARD_DIR}: no wizard output to check — the gate would pass vacuously`,
    ]);
    expect(await main(docs, quiet)).toBe(1);
  });
});

describe('runtime option migration guidance', () => {
  it('keeps the recommended and full configuration examples accepted by the runtime schema', async () => {
    const guide = await fs.readFile(path.resolve(DOCS_ROOT, '../doc/configuration.md'), 'utf8');
    const blocks = [...guide.matchAll(/```[^\n]*\n([\s\S]*?)```/g)].map((match) =>
      match[1].replace(/^\s*\/\/.*$/gm, ''),
    );
    const recommended = JSON.parse(blocks[0]);
    const full = {insert_options: JSON.parse(`{${blocks[1]}}`)};
    expect(validateWizardOutput(recommended)).toEqual([]);
    expect(validateWizardOutput(full)).toEqual([]);
    expect(guide).toContain('fresh database');
    expect(guide).toContain('json_type is retired');
  });

  it('describes the old CLI switch as rejected, not as an effective option', async () => {
    const guide = await fs.readFile(
      path.resolve(DOCS_ROOT, '../doc/command-line-options.md'),
      'utf8',
    );
    const line = guide.split('\n').find((text) => text.includes('`--disable-in-out`'));
    expect(line).toContain('retired');
    expect(line).toContain('tx_out.value');
    expect(line).not.toContain('Disables');
  });
});
