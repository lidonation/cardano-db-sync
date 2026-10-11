/**
 * The db-sync config schema, as the binary parses it (B10, CON-4).
 *
 * `generated/config-schema.json` is extracted by `docs/extractor` (`extract-config`) from the
 * `FromJSON` instances in `Cardano.DbSync.Config.Types`; nothing here reads Haskell. This module
 * is plain JavaScript so the build gate (`scripts/check-config.mjs`, run by Node with no build
 * step) and the config wizard share one validator — the wizard cannot drift from the gate.
 * Types live in `config-schema.d.mts`; `dbsync-config.ts` binds these helpers to the committed
 * artifact.
 */

/** Must match `configSchemaVersion` in `docs/extractor/src/ConfigExtract.hs`. */
export const CONFIG_SCHEMA_VERSION = 1;

/**
 * Everything wrong with a config document, as readable lines naming the dotted path. An empty
 * array means db-sync would read every key and accept every value.
 *
 * Unknown keys are reported even though the binary would not fail on them: aeson ignores keys a
 * parser never asks for, so an unknown option is silently dropped — exactly the drift CON-4 rules
 * out.
 *
 * @param {import('./config-schema.d.mts').ConfigSchema} schema
 * @param {unknown} config a parsed config document
 * @param {{fragment?: boolean}} [options] `fragment`: the document is merged into a full config
 *   file (what the wizard emits), so top-level required keys may be absent. Nested required keys
 *   are still required.
 * @returns {string[]}
 */
export function validateConfig(schema, config, options = {}) {
  const problems = [];
  const passthrough = new Set(schema.passthrough.flatMap((p) => p.keys));
  validateObject(schema.config, config, '', problems, {
    passthrough,
    relaxRequired: options.fragment === true,
  });
  return problems;
}

function validateObject(shape, value, at, problems, {passthrough, relaxRequired}) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    problems.push(`${label(at)}: expected an object (${shape.haskell}), got ${describe(value)}`);
    return;
  }
  const keys = new Map(shape.keys.map((key) => [key.name, key]));
  for (const [name, child] of Object.entries(value)) {
    const key = keys.get(name);
    const path = join(at, name);
    if (key) {
      validateValue(key.shape, child, path, problems);
    } else if (!(passthrough?.has(name) ?? false)) {
      problems.push(
        `${path}: not an option db-sync reads — ${shape.haskell} accepts ${[...keys.keys()].join(', ')}`,
      );
    }
  }
  if (!relaxRequired) {
    for (const key of shape.keys) {
      if (key.required && !(key.name in value)) {
        problems.push(`${join(at, key.name)}: required by ${shape.haskell}`);
      }
    }
  }
}

function validateValue(shape, value, at, problems) {
  if (value === null) {
    if (!shape.nullable) problems.push(`${at}: null is not accepted`);
    return;
  }
  switch (shape.type) {
    case 'boolean':
      if (typeof value !== 'boolean')
        problems.push(`${at}: expected true or false, got ${describe(value)}`);
      return;
    case 'integer':
      if (!Number.isInteger(value))
        problems.push(`${at}: expected an integer, got ${describe(value)}`);
      return;
    case 'string':
      if (typeof value !== 'string')
        problems.push(`${at}: expected a string, got ${describe(value)}`);
      return;
    case 'enum':
      if (!shape.values.includes(value)) {
        problems.push(`${at}: ${describe(value)} is not one of ${shape.values.join(', ')}`);
      }
      return;
    case 'array':
      if (!Array.isArray(value)) {
        problems.push(`${at}: expected a list, got ${describe(value)}`);
        return;
      }
      value.forEach((item, i) => validateValue(shape.items, item, `${at}[${i}]`, problems));
      return;
    case 'object':
      validateObject(shape, value, at, problems, {passthrough: null, relaxRequired: false});
      return;
    case 'opaque':
      return;
    default:
      problems.push(`${at}: the schema has an unknown shape type ${JSON.stringify(shape.type)}`);
  }
}

/**
 * Every option as a flat list of dotted paths (`insert_options.tx_out.value`), in source order,
 * with its shape and default — the option universe the wizard draws from.
 *
 * @param {import('./config-schema.d.mts').ConfigSchema} schema
 * @returns {import('./config-schema.d.mts').ConfigOption[]}
 */
export function listOptions(schema) {
  const out = [];
  const walk = (shape, at) => {
    for (const key of shape.keys) {
      const path = join(at, key.name);
      out.push({path, required: key.required, shape: key.shape, default: key.default});
      if (key.shape.type === 'object') walk(key.shape, path);
    }
  };
  walk(schema.config, '');
  return out;
}

/**
 * The option values a preset switches on (`insert_options.preset` = `only_utxo`), keyed by the
 * sibling option names — what the binary uses when the preset is chosen and nothing overrides
 * it. `undefined` when the path is not a preset or the value is not one of its values.
 *
 * @param {import('./config-schema.d.mts').ConfigSchema} schema
 * @param {string} presetPath dotted path of the preset key
 * @param {string} value
 * @returns {Record<string, unknown> | undefined}
 */
export function presetValues(schema, presetPath, value) {
  const parts = presetPath.split('.');
  const presetKey = parts.pop();
  let shape = schema.config;
  for (const part of parts) {
    const key = shape.keys.find((k) => k.name === part);
    if (!key || key.shape.type !== 'object') return undefined;
    shape = key.shape;
  }
  const preset = (shape.presets ?? []).find((p) => p.key === presetKey);
  return preset?.values[value];
}

function join(at, name) {
  return at === '' ? name : `${at}.${name}`;
}

function label(at) {
  return at === '' ? '(config root)' : at;
}

function describe(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'a list';
  if (typeof value === 'object') return 'an object';
  return JSON.stringify(value);
}
