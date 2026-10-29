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

/** Project inherited defaults and preset overrides onto just the declared child path. */
function configContract(path, node, ancestors) {
  const project = (value, parts) => {
    for (const part of parts) {
      if (!value || typeof value !== 'object' || !Object.hasOwn(value, part)) return undefined;
      value = value[part];
    }
    return value;
  };
  const context = ancestors.map(({path: parentPath, node: parent}) => {
    const parts = path.slice(parentPath.length + 1).split('.');
    const presets = (parent.shape?.presets ?? []).flatMap(({key, values}) => {
      const relevant = Object.fromEntries(
        Object.entries(values).flatMap(([name, overrides]) => {
          const value = project(overrides, parts);
          return value === undefined ? [] : [[name, value]];
        }),
      );
      return Object.keys(relevant).length ? [{key, values: relevant}] : [];
    });
    const inheritedDefault = project(parent.default, parts);
    return {
      path: parentPath,
      ...(parent.required !== undefined ? {required: parent.required} : {}),
      nullable: parent.shape?.nullable ?? false,
      ...(inheritedDefault !== undefined ? {default: inheritedDefault} : {}),
      ...(presets.length ? {presets} : {}),
    };
  });
  return semanticConfig({path, key: node, context});
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
  function visit(nodes, prefix = '', ancestors = []) {
    for (const node of nodes ?? []) {
      const key = prefix ? `${prefix}.${node.name}` : node.name;
      keys[key] = {node, ancestors};
      visit(node.shape?.keys, key, [...ancestors, {path: key, node}]);
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
          const {node, ancestors} = keys[candidates[0]];
          const contract = configContract(candidates[0], node, ancestors);
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
        } else {
          const [table, column] = id.split('.');
          const movedTable =
            kind === 'columns' &&
            renames.entities?.find(
              (entity) =>
                entity.kind === 'table' &&
                entity.formerNames?.some((entry) => entry.name === table),
            );
          if (movedTable) {
            const movedColumn = renames.entities?.find(
              (entity) =>
                entity.kind === 'column' &&
                entity.table === movedTable.name &&
                entity.formerNames?.some((entry) => entry.name === column),
            );
            const current = `${movedTable.name}.${movedColumn?.name ?? column}`;
            const exists = tables.some(
              (entry) =>
                entry.name === movedTable.name &&
                entry.columns.some((entry) => entry.name === (movedColumn?.name ?? column)),
            );
            errors.push(
              exists
                ? `${name}: ${id} was renamed to ${current}; review the declaration`
                : `${name}: table ${table} was renamed to ${movedTable.name}; review the declaration ${id}`,
            );
          } else errors.push(`${name}: unknown ${kind} entity ${id}`);
        }
      } else lock[`${kind}:${id}`] = value;
    }
  }
  const body = source
    .slice(match[0].length)
    .replace(/\]\([^\n)]*\)/g, ']()')
    .replace(/https?:\/\/[^\s<>)]+/g, '')
    // Lowercase quoted SQL identifiers name the same entities as their unquoted forms.
    .replace(/"([a-z][a-z0-9_]*)"/g, '$1')
    // SQL permits whitespace around dots. Limit that rewrite to SQL fences so a prose
    // sentence ending in a table name cannot turn into a spurious column reference.
    .replace(
      /(`{3,}|~{3,})(sql|postgresql|postgres)\b[^\n]*\n([\s\S]*?)\1/g,
      (_, fence, language, sql) =>
        `${fence}${language}\n${sql.replace(/([a-z0-9_])[ \t]*\.[ \t]*(?=[a-z])/g, '$1.')}${fence}`,
    );
  for (const ref of body.matchAll(/\b(?:public\.)?([a-z][a-z0-9_]*\.[a-z][a-z0-9_]*)\b/g)) {
    const id = ref[1];
    const [table, column] = id.split('.');
    const candidates = tables.filter((t) => t.name === table);
    if (!candidates.length) continue;
    const columnExists = candidates.some((t) => t.columns.some((c) => c.name === column));
    const configExists = Object.keys(keys).some((key) => key === id || key.endsWith(`.${id}`));
    if (!columnExists && !configExists)
      errors.push(`${name}: body references unknown column ${id}`);
    else if (columnExists && !declared.has(`columns:${id}`))
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
  const columnOwners = new Map();
  for (const table of tables)
    for (const column of table.columns) {
      if (!columnOwners.has(column.name)) columnOwners.set(column.name, new Set());
      columnOwners.get(column.name).add(table.name);
    }
  const bareNames = new Set([
    ...Array.from(
      body.matchAll(/(?<![A-Za-z0-9_.])([a-z][a-z0-9_]*_[a-z0-9_]+)(?![A-Za-z0-9_.])/g),
      (match) => match[1],
    ),
    ...Array.from(body.matchAll(/`([a-z][a-z0-9_]*)`/g), (match) => match[1]),
  ]);
  for (const column of bareNames) {
    const owners = columnOwners.get(column);
    if (owners?.size !== 1) continue;
    const id = `${owners.values().next().value}.${column}`;
    if (!declared.has(`columns:${id}`))
      warnings.push(`${name}: body references undeclared column ${id}`);
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
      snapshot.entities.some((id) => typeof id !== 'string' || !id) ||
      (snapshot.variants !== undefined &&
        (!Array.isArray(snapshot.variants) ||
          !snapshot.variants.length ||
          snapshot.variants.some(
            (entities) =>
              !Array.isArray(entities) || entities.some((id) => typeof id !== 'string' || !id),
          )))
    )
      return {versions: [], errors: ['invalid or duplicate historical snapshot']};
    names.add(snapshot.version);
  }
  const unknown = required.filter(
    (id) => !history.some((snapshot) => snapshot.entities.includes(id)),
  );
  if (unknown.length) return {versions: [], errors: unknown.map((id) => `unknown entity ${id}`)};
  const versions = history
    .filter((snapshot) =>
      snapshot.variants
        ? snapshot.variants.some((entities) => required.every((id) => entities.includes(id)))
        : required.every((id) => snapshot.entities.includes(id)),
    )
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
      variants: {},
    };
  const match = source.match(/^---\s*\n([\s\S]*?)\n---\s*(?:\n|$)/);
  let front;
  try {
    front = match && yaml.load(match[1]);
  } catch {
    return {
      ...evaluateGuide(name, source, history[0].schema, history[0].config),
      versions: [],
      variants: {},
    };
  }
  if (
    !front ||
    typeof front !== 'object' ||
    Array.isArray(front) ||
    !front.requires ||
    typeof front.requires !== 'object' ||
    Array.isArray(front.requires)
  )
    return {
      ...evaluateGuide(name, source, history[0].schema, history[0].config),
      versions: [],
      variants: {},
    };
  const required = [];
  for (const [kind, list] of Object.entries(front.requires)) {
    if (
      !['tables', 'columns', 'config'].includes(kind) ||
      !Array.isArray(list) ||
      list.some((id) => typeof id !== 'string')
    )
      return {
        ...evaluateGuide(name, source, history[0].schema, history[0].config),
        versions: [],
        variants: {},
      };
    required.push(...list.map((id) => `${kind}:${id}`));
  }
  const snapshots = history.map((snapshot) => {
    const names = [
      ...new Set(
        snapshot.schema.tables
          .map((table) => table.variant)
          .filter((variant) => variant && variant !== 'all'),
      ),
    ];
    names.sort();
    if (!names.length) names.push('all');
    const variants = names.map((variant) => {
      const tables = snapshot.schema.tables.filter(
        (table) => table.variant === 'all' || table.variant === variant,
      );
      return {
        variant,
        entities: Object.keys(
          evaluateGuide(name, match[0], {...snapshot.schema, tables}, snapshot.config).lock,
        ),
      };
    });
    return {
      version: snapshot.tag,
      names,
      variants: variants.map((variant) => variant.entities),
      entities: [...new Set(variants.flatMap((variant) => variant.entities))],
    };
  });
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
      variants: {},
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
      variants: {},
    };
  }
  const selected = history.find((snapshot) => snapshot.tag === range.versions.at(-1));
  const variants = Object.fromEntries(
    snapshots
      .filter((snapshot) => range.versions.includes(snapshot.version))
      .map((snapshot) => [
        snapshot.version,
        snapshot.names.filter((_, index) =>
          required.every((id) => snapshot.variants[index].includes(id)),
        ),
      ]),
  );
  const selectedVariants = variants[selected.tag];
  const tables = selected.schema.tables.filter(
    (table) => table.variant === 'all' || selectedVariants.includes(table.variant),
  );
  const result = evaluateGuide(
    name,
    source,
    {...selected.schema, tables},
    selected.config,
    previous,
    renames,
  );
  return {...result, versions: range.versions, variants};
}
