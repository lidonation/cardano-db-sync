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
export const CONFIG_SCHEMA_VERSION = 2;

/**
 * Structural checks shared by the build gate and the typed artifact loader. Invalid schemas
 * cannot make a config check pass by deleting keys, substituting opaque shapes, or emptying enums.
 * @param {unknown} schema
 * @returns {string[]}
 */
export function findSchemaProblems(schema) {
  const problems = [];
  const object = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  const text = (v) => typeof v === 'string' && v.trim() !== '';
  const fail = (at, message) => problems.push(`${at}: ${message}`);
  if (!object(schema)) return ['schema must be an object'];
  if (schema.schemaVersion !== CONFIG_SCHEMA_VERSION) {
    problems.push(`schema version ${schema.schemaVersion} is not ${CONFIG_SCHEMA_VERSION}`);
  }
  if (!text(schema.root)) fail('root', 'must name a Haskell type');
  if (!Array.isArray(schema.unresolved) || schema.unresolved.length > 0) {
    problems.push(
      `the schema has parts the extractor could not read: ${JSON.stringify(schema.unresolved)}`,
    );
  }
  if (!Array.isArray(schema.sources) || schema.sources.length === 0) {
    fail('sources', 'must be a non-empty array');
  } else {
    for (const source of schema.sources) {
      if (
        !text(source) ||
        source.startsWith('/') ||
        source.includes('\\') ||
        source.split('/').some((p) => p === '' || p === '.' || p === '..') ||
        !source.endsWith('.hs')
      ) {
        fail('sources', 'each source must be a repository-relative .hs path');
      }
    }
    if (new Set(schema.sources).size !== schema.sources.length) fail('sources', 'must be unique');
  }
  if (!Array.isArray(schema.passthrough)) {
    problems.push('passthrough must be an array');
  } else {
    for (const pass of schema.passthrough) {
      if (
        !object(pass) ||
        !text(pass.reader) ||
        !Array.isArray(pass.keys) ||
        pass.keys.length === 0 ||
        !pass.keys.every(text) ||
        new Set(pass.keys).size !== pass.keys.length
      ) {
        fail('passthrough', 'each reader must name unique non-empty keys');
      }
    }
  }
  const decimal = (v) => typeof v === 'string' && /^(0|-[1-9][0-9]*|[1-9][0-9]*)$/.test(v);
  const walk = (shape, at) => {
    if (!object(shape)) {
      fail(at, 'shape must be an object');
      return;
    }
    if (shape.nullable !== undefined && shape.nullable !== true)
      fail(at, 'nullable must be true when present');
    switch (shape.type) {
      case 'boolean':
      case 'string':
        return;
      case 'integer':
        for (const bound of ['minimum', 'maximum']) {
          if (shape[bound] !== undefined && !decimal(shape[bound]))
            fail(at, `${bound} must be a decimal integer string`);
        }
        if (
          decimal(shape.minimum) &&
          decimal(shape.maximum) &&
          BigInt(shape.minimum) > BigInt(shape.maximum)
        )
          fail(at, 'minimum exceeds maximum');
        return;
      case 'enum':
        if (
          !Array.isArray(shape.values) ||
          shape.values.length === 0 ||
          !shape.values.every(text) ||
          new Set(shape.values).size !== shape.values.length
        )
          fail(at, 'enum values must be unique non-empty strings');
        return;
      case 'array':
        if (
          shape.minItems !== undefined &&
          (!Number.isSafeInteger(shape.minItems) || shape.minItems < 0)
        )
          fail(at, 'minItems must be a non-negative safe integer');
        walk(shape.items, `${at}[]`);
        return;
      case 'object': {
        if (!text(shape.haskell) || !Number.isSafeInteger(shape.line) || shape.line < 1)
          fail(at, 'object must name its Haskell type and positive source line');
        if (!Array.isArray(shape.keys) || shape.keys.length === 0) {
          fail(at, 'object keys must be a non-empty array');
          return;
        }
        const names = new Set();
        for (const key of shape.keys) {
          if (!object(key) || !text(key.name) || typeof key.required !== 'boolean') {
            fail(at, 'each key must have a name and required boolean');
            continue;
          }
          if (names.has(key.name)) fail(at, `duplicate key ${key.name}`);
          names.add(key.name);
          walk(key.shape, `${at}.${key.name}`);
        }
        if (shape.presets !== undefined) {
          if (!Array.isArray(shape.presets)) {
            fail(at, 'presets must be an array');
            return;
          }
          const seen = new Set();
          for (const preset of shape.presets) {
            const key = shape.keys.find((k) => k?.name === preset?.key);
            if (
              !object(preset) ||
              seen.has(preset.key) ||
              key?.shape?.type !== 'enum' ||
              !Array.isArray(key.shape.values) ||
              !object(preset.values)
            ) {
              fail(at, 'each preset must refer to a unique enum key and have values');
              continue;
            }
            seen.add(preset.key);
            if (
              Object.keys(preset.values).length !== key.shape.values.length ||
              !key.shape.values.every((v) => Object.hasOwn(preset.values, v))
            )
              fail(at, `preset ${preset.key} must cover exactly its enum values`);
            for (const [name, overrides] of Object.entries(preset.values)) {
              if (!object(overrides)) {
                fail(at, `preset ${name} must be an object`);
                continue;
              }
              for (const sibling of Object.keys(overrides))
                if (!names.has(sibling) || sibling === preset.key)
                  fail(at, `preset ${name} has unknown sibling ${sibling}`);
            }
          }
        }
        return;
      }
      default:
        fail(at, `unsupported shape type ${JSON.stringify(shape.type)}`);
    }
  };
  if (
    !object(schema.config) ||
    schema.config.type !== 'object' ||
    !Array.isArray(schema.config.keys)
  ) {
    problems.push('the schema root must be an object with keys');
  } else {
    walk(schema.config, 'config');
    if (schema.config.haskell !== schema.root) fail('root', 'must match the config Haskell type');
  }
  if (problems.length === 0) {
    const defaults = (shape, at) => {
      if (shape.type === 'array') defaults(shape.items, `${at}[]`);
      if (shape.type !== 'object') return;
      for (const key of shape.keys) {
        if (Object.hasOwn(key, 'default'))
          validateValue(key.shape, key.default, `${at}.${key.name} default`, problems);
        defaults(key.shape, `${at}.${key.name}`);
      }
      for (const preset of shape.presets ?? []) {
        for (const [value, overrides] of Object.entries(preset.values)) {
          for (const [name, option] of Object.entries(overrides)) {
            validateValue(
              shape.keys.find((k) => k.name === name).shape,
              option,
              `${at}.${preset.key}=${value}.${name}`,
              problems,
            );
          }
        }
      }
    };
    defaults(schema.config, 'config');
  }
  return problems;
}

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
  const problems = findSchemaProblems(schema);
  if (problems.length > 0) return problems;
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
      if (key.required && !Object.hasOwn(value, key.name)) {
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
      if (!Number.isSafeInteger(value)) {
        problems.push(`${at}: expected a safe integer, got ${describe(value)}`);
      } else if (
        (shape.minimum !== undefined && BigInt(value) < BigInt(shape.minimum)) ||
        (shape.maximum !== undefined && BigInt(value) > BigInt(shape.maximum))
      ) {
        problems.push(
          `${at}: ${value} is outside ${shape.haskell ?? 'integer'} bounds (${shape.minimum ?? 'unbounded'} to ${shape.maximum ?? 'unbounded'})`,
        );
      }
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
      if (value.length < (shape.minItems ?? 0)) {
        problems.push(`${at}: expected at least ${shape.minItems} item(s), got ${value.length}`);
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
  return preset && Object.hasOwn(preset.values, value)
    ? JSON.parse(JSON.stringify(preset.values[value]))
    : undefined;
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
