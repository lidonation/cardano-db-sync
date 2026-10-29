import {createHash} from 'node:crypto';
import yaml from 'js-yaml';
import {canonicalJson} from './schema-model.mjs';

const comparable = (value) => canonicalJson(JSON.parse(JSON.stringify(value ?? null)));

const digest = (value) =>
  `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`;

function semanticConfig(value) {
  if (Array.isArray(value)) return value.map(semanticConfig);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .filter(
          ([key]) =>
            !(
              key === 'line' &&
              value.type === 'object' &&
              Array.isArray(value.keys) &&
              typeof value.haskell === 'string'
            ),
        )
        .map(([key, item]) => [key, key === 'default' ? item : semanticConfig(item)]),
    );
  return value;
}

/** Evaluate a guide against the current extracted contracts.
 * @param {string} name
 * @param {string} source
 * @param {any} schema
 * @param {any} config
 * @param {any} [previous]
 * @param {{entities: Array<{kind: string, table?: string, name: string, formerNames?: Array<{name: string}>}>}} [renames]
 */
export function evaluateGuide(name, source, schema, config, previous, renames = {entities: []}) {
  const errors = [];
  const warnings = [];
  const lock = {};
  const match = source.match(/^---\s*\n([\s\S]*?)\n---\s*(?:\n|$)/);
  if (!match) return {errors: [`${name}: missing YAML frontmatter`], warnings, lock};
  let front;
  try {
    front = yaml.load(match[1]);
  } catch (error) {
    return {errors: [`${name}: invalid frontmatter: ${error.message}`], warnings, lock};
  }
  if (!front || typeof front !== 'object' || Array.isArray(front))
    return {errors: [`${name}: frontmatter must be a mapping`], warnings, lock};
  for (const key of ['schema_range', 'schema_version', 'version_range', 'supported_versions'])
    if (Object.hasOwn(front, key))
      errors.push(`${name}: ${key} is derived from requires, not hand-written`);
  const requires = front.requires;
  if (!requires || typeof requires !== 'object' || Array.isArray(requires))
    return {errors: [`${name}: requires must be a mapping`], warnings, lock};
  if (
    Object.hasOwn(front, 'range_override') &&
    (typeof front.range_override?.reason !== 'string' || !front.range_override.reason.trim())
  )
    errors.push(`${name}: range_override requires a reason`);
  const declared = new Set();
  const tables = schema.tables ?? [];
  const keys = Object.create(null);
  function visit(nodes, prefix = '') {
    for (const node of nodes ?? []) {
      const key = prefix ? `${prefix}.${node.name}` : node.name;
      keys[key] = node;
      visit(node.shape?.keys, key);
    }
  }
  visit(config.config?.keys);
  for (const [kind, list] of Object.entries(requires)) {
    if (
      !['tables', 'columns', 'config'].includes(kind) ||
      !Array.isArray(list) ||
      list.some((v) => typeof v !== 'string')
    ) {
      errors.push(`${name}: requires.${kind} must be a supported list of identifiers`);
      continue;
    }
    for (const id of list) {
      if (declared.has(`${kind}:${id}`)) errors.push(`${name}: duplicate ${kind} ${id}`);
      declared.add(`${kind}:${id}`);
      let value;
      if (kind === 'tables') {
        const found = tables.filter((t) => t.name === id);
        if (found.length) value = digest(found.map((t) => ({variant: t.variant, kind: t.kind})));
      } else if (kind === 'columns') {
        const parts = id.split('.');
        const [table, column] = parts;
        const found = tables
          .filter((t) => t.name === table)
          .flatMap((t) =>
            t.columns
              .filter((c) => c.name === column)
              .map((c) => ({
                variant: t.variant,
                fingerprint: c.fingerprint,
                resolved_type: c.resolved_type,
                nullable: c.nullable,
                default: c.default,
              })),
          );
        if (parts.length === 2 && table && column && found.length) value = found;
      } else {
        const candidates = Object.keys(keys).filter((key) => key === id || key.endsWith(`.${id}`));
        if (candidates.length === 1) {
          const contract = semanticConfig(keys[candidates[0]]);
          value = {fingerprint: digest(contract), contract};
        } else if (candidates.length > 1)
          errors.push(`${name}: ambiguous config entity ${id}; use a full path`);
      }
      if (value === undefined) {
        const renamed = renames.entities?.find((entity) => {
          const former =
            kind === 'tables' && entity.kind === 'table'
              ? id
              : kind === 'columns' && entity.kind === 'column' && id.startsWith(`${entity.table}.`)
                ? id.slice(entity.table.length + 1)
                : null;
          return former !== null && entity.formerNames?.some((entry) => entry.name === former);
        });
        if (renamed) {
          const current =
            renamed.kind === 'column' ? `${renamed.table}.${renamed.name}` : renamed.name;
          errors.push(`${name}: ${id} was renamed to ${current}; review the declaration`);
        } else errors.push(`${name}: unknown ${kind} entity ${id}`);
      } else lock[`${kind}:${id}`] = value;
    }
  }
  const body = source
    .slice(match[0].length)
    .replace(/\]\([^\n)]*\)/g, ']()')
    .replace(/https?:\/\/[^\s<>)]+/g, '');
  for (const ref of body.matchAll(/\b(?:public\.)?([a-z][a-z0-9_]*\.[a-z][a-z0-9_]*)\b/g)) {
    const id = ref[1];
    const [table, column] = id.split('.');
    const candidates = tables.filter((t) => t.name === table);
    if (!candidates.length) continue;
    const columnExists = candidates.some((t) => t.columns.some((c) => c.name === column));
    const configExists = Object.keys(keys).some((key) => key === id || key.endsWith(`.${id}`));
    if (!columnExists && !configExists)
      errors.push(`${name}: body references unknown column ${id}`);
    else if (columnExists && !declared.has(`columns:${id}`) && !declared.has(`config:${id}`))
      warnings.push(`${name}: body references undeclared column ${id}`);
  }
  const reported = new Set();
  for (const match of body.matchAll(/\b[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*\b/g)) {
    const id = match[0];
    if (
      !id.includes('.') &&
      tables.some((table) => table.name === id) &&
      !declared.has(`tables:${id}`)
    ) {
      if (!reported.has(`table:${id}`))
        warnings.push(`${name}: body references undeclared table ${id}`);
      reported.add(`table:${id}`);
    }
    const configMatches = Object.keys(keys).filter((key) => key === id || key.endsWith(`.${id}`));
    if (
      configMatches.length === 1 &&
      ![...declared].some(
        (entry) =>
          entry.startsWith('config:') &&
          (entry.slice(7) === id || configMatches[0] === entry.slice(7)),
      )
    ) {
      if (!reported.has(`config:${id}`))
        warnings.push(`${name}: body references undeclared config ${id}`);
      reported.add(`config:${id}`);
    }
  }
  const changes = [];
  if (previous) {
    for (const key of new Set([...Object.keys(previous), ...Object.keys(lock)])) {
      if (comparable(previous[key]) !== comparable(lock[key])) {
        changes.push({key, reviewed: previous[key] ?? null, current: lock[key] ?? null});
      }
    }
  }

  return {errors, warnings, lock, changes};
}

export {guidesForTable} from '../../src/data/guide-locks.mjs';

/** Intersect entity existence over explicitly supplied snapshots; never infer history from current schema. */
export function deriveApplicability(history, required) {
  if (!Array.isArray(history) || history.length === 0)
    return {versions: [], errors: ['historical entity snapshots are unavailable']};
  if (!Array.isArray(required) || required.some((id) => typeof id !== 'string' || !id))
    return {versions: [], errors: ['invalid required entities']};
  const names = new Set();
  for (const snapshot of history) {
    if (
      typeof snapshot?.version !== 'string' ||
      !snapshot.version ||
      names.has(snapshot.version) ||
      !Array.isArray(snapshot.entities) ||
      snapshot.entities.some((id) => typeof id !== 'string' || !id)
    )
      return {versions: [], errors: ['invalid or duplicate historical snapshot']};
    names.add(snapshot.version);
  }
  const unknown = required.filter(
    (id) => !history.some((snapshot) => snapshot.entities.includes(id)),
  );
  if (unknown.length) return {versions: [], errors: unknown.map((id) => `unknown entity ${id}`)};
  const versions = history
    .filter((snapshot) => required.every((id) => snapshot.entities.includes(id)))
    .map((snapshot) => snapshot.version);
  return {versions, errors: versions.length ? [] : ['empty version intersection']};
}

/** A manual range can only narrow, never expand or rescue a stale declaration. */
export function resolveGuideRange(history, required, override) {
  const derived = deriveApplicability(history, required);
  if (derived.errors.length || override === undefined) return derived;
  if (
    !override ||
    typeof override !== 'object' ||
    Array.isArray(override) ||
    typeof override.reason !== 'string' ||
    !override.reason.trim()
  )
    return {versions: [], errors: ['range override requires a reason']};
  if (Object.keys(override).some((key) => !['versions', 'reason'].includes(key)))
    return {versions: [], errors: ['range override contains unrecognised attributes']};
  if (
    !Array.isArray(override.versions) ||
    !override.versions.length ||
    override.versions.some((version) => typeof version !== 'string') ||
    new Set(override.versions).size !== override.versions.length
  )
    return {versions: [], errors: ['range override requires a nonempty unique version list']};
  const outside = override.versions.filter((version) => !derived.versions.includes(version));
  if (outside.length)
    return {
      versions: [],
      errors: [
        `range override includes versions outside the entity intersection: ${outside.join(', ')}`,
      ],
    };
  return {
    versions: derived.versions.filter((version) => override.versions.includes(version)),
    errors: [],
  };
}

/** Resolve declarations across supplied, independently extracted historical release snapshots.
 * @param {string} name
 * @param {string} source
 * @param {any[]} history
 * @param {any} [previous]
 * @param {{entities: Array<{kind: string, table?: string, name: string, formerNames?: Array<{name: string}>}>}} [renames]
 */
export function evaluateHistoricalGuide(name, source, history, previous, renames = {entities: []}) {
  if (!Array.isArray(history) || !history.length)
    return {
      errors: [`${name}: historical entity history unavailable`],
      warnings: [],
      lock: {},
      versions: [],
    };
  const match = source.match(/^---\s*\n([\s\S]*?)\n---\s*(?:\n|$)/);
  let front;
  try {
    front = match && yaml.load(match[1]);
  } catch {
    return {...evaluateGuide(name, source, history[0].schema, history[0].config), versions: []};
  }
  if (
    !front ||
    typeof front !== 'object' ||
    Array.isArray(front) ||
    !front.requires ||
    typeof front.requires !== 'object' ||
    Array.isArray(front.requires)
  )
    return {...evaluateGuide(name, source, history[0].schema, history[0].config), versions: []};
  const required = [];
  for (const [kind, list] of Object.entries(front.requires)) {
    if (
      !['tables', 'columns', 'config'].includes(kind) ||
      !Array.isArray(list) ||
      list.some((id) => typeof id !== 'string')
    )
      return {...evaluateGuide(name, source, history[0].schema, history[0].config), versions: []};
    required.push(...list.map((id) => `${kind}:${id}`));
  }
  const snapshots = history.map((snapshot) => ({
    version: snapshot.tag,
    entities: Object.keys(evaluateGuide(name, match[0], snapshot.schema, snapshot.config).lock),
  }));
  const range = resolveGuideRange(snapshots, required, front.range_override);
  if (range.errors.length) {
    const current = history.find((snapshot) => snapshot.tag === 'current');
    const hints = current
      ? evaluateGuide(
          name,
          source,
          current.schema,
          current.config,
          previous,
          renames,
        ).errors.filter((error) => error.includes(' was renamed to '))
      : [];
    return {
      errors: [...range.errors.map((error) => `${name}: ${error}`), ...hints],
      warnings: [],
      lock: {},
      versions: [],
    };
  }
  if (
    history.some((snapshot) => snapshot.tag === 'current') &&
    !range.versions.includes('current') &&
    front.range_override === undefined
  ) {
    const current = history.find((snapshot) => snapshot.tag === 'current');
    const result = evaluateGuide(name, source, current.schema, current.config, previous, renames);
    return {
      ...result,
      errors: [
        ...result.errors,
        `${name}: removed current entity requires a reasoned range override`,
      ],
      versions: [],
    };
  }
  const selected = history.find((snapshot) => snapshot.tag === range.versions.at(-1));
  const result = evaluateGuide(name, source, selected.schema, selected.config, previous, renames);
  return {...result, versions: range.versions};
}
