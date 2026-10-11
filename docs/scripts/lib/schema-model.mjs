/**
 * B08 — the schema artifact model: column fingerprints with domains resolved transitively
 * (SCH-1, GDE-6).
 *
 * A column's identity is `(name, resolved_type, nullable, default)`. `resolved_type` walks every
 * domain down to its concrete base type and carries the CHECK set of every domain on the way:
 * `outsum → word128type → numeric(39,0)`. Stopping at the domain name is what hid the 2-0030
 * migration, which dropped the CHECK on every domain without changing a single column definition.
 *
 * Everything here is pure: it takes catalog rows (read from a replayed database by
 * `schema-db.mjs`) and the Haskell tables (`schema-haskell.mjs`) and returns the artifact. That
 * keeps the rules unit-testable with no Postgres present.
 */
import {createHash} from 'node:crypto';

/** @typedef {import('../../src/data/schema').SchemaArtifact} SchemaArtifact */
/** @typedef {import('../../src/data/schema').ResolvedType} ResolvedType */

/** Version of the artifact's shape. Must match SCHEMA_ARTIFACT_VERSION in src/data/schema.ts. */
export const ARTIFACT_VERSION = 1;

/** Where the artifact is committed, relative to the docs directory. */
export const ARTIFACT_FILE = 'generated/schema.json';

/** The Postgres major the artifact is extracted with. Catalog rendering is stable within a major. */
export const POSTGRES_MAJOR = 17;

/** The tx_out variants db-sync can run with (`tx_out.use_address_table`). */
export const VARIANTS = ['core', 'address'];

/** A JSON string with object keys sorted at every level, so equal values hash equally. */
export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/** The GDE-6 fingerprint: a hash over exactly `(name, resolved_type, nullable, default)`. */
export function fingerprint({name, resolved_type, nullable, default: def}) {
  const identity = canonicalJson({name, resolved_type, nullable, default: def});
  return `sha256:${createHash('sha256').update(identity).digest('hex')}`;
}

/**
 * Resolve any catalog type: a domain (walked transitively), an enum (with its labels), or an array
 * of either (resolved as `element`). Returns null for a type the catalog snapshot does not carry,
 * which is a plain base type.
 *
 * @param {number} oid
 * @param {Map<number, object>} types catalog rows keyed by oid (`{oid, name, kind: 'd' | 'e' | 'a',
 *   base_oid, elem_oid, base_format, not_null, default, checks, labels}`)
 * @returns {{resolved: ResolvedType, default: string | null} | null}
 */
export function resolveType(oid, types) {
  const type = types.get(oid);
  if (!type) return null;
  if (type.kind === 'd') return resolveDomain(oid, types);
  if (type.kind === 'e') {
    return {
      resolved: {base: type.name, domains: [], checks: [], not_null: false, enum: [...type.labels]},
      default: null,
    };
  }
  // An array: element constraints (CHECK, NOT NULL) apply to the elements, never to the array
  // value, so they stay inside `element` and do not make the column NOT NULL.
  const element = resolveType(type.elem_oid, types);
  if (!element) throw new Error(`array type ${type.name} has no resolvable element`);
  return {
    resolved: {
      base: `${element.resolved.base}[]`,
      domains: [],
      checks: [],
      not_null: false,
      element: element.resolved,
    },
    default: null,
  };
}

/**
 * Resolve one domain to its concrete base type, transitively: the chain (outermost first), every
 * CHECK on it, domain NOT NULL, the outermost default, and the enum labels or array element the
 * chain ends at.
 *
 * @param {number} oid the domain's type oid
 * @param {Map<number, object>} types catalog rows keyed by oid
 * @returns {{resolved: ResolvedType, default: string | null}}
 */
export function resolveDomain(oid, types) {
  const domains = [];
  const checks = [];
  let notNull = false;
  let domainDefault = null;
  let current = types.get(oid);
  const seen = new Set();
  while (current && current.kind === 'd') {
    if (seen.has(current.oid)) throw new Error(`domain cycle at ${current.name}`);
    seen.add(current.oid);
    domains.push(current.name);
    for (const definition of [...current.checks].sort())
      checks.push({domain: current.name, definition});
    notNull ||= current.not_null;
    // The outermost domain's default wins, as it does in Postgres.
    domainDefault ??= current.default;
    const next = types.get(current.base_oid);
    if (!next || next.kind !== 'd') {
      const inner = next ? resolveType(next.oid, types).resolved : null;
      const resolved = {
        base: inner ? inner.base : current.base_format,
        domains,
        checks,
        not_null: notNull,
      };
      if (inner?.enum) resolved.enum = inner.enum;
      if (inner?.element) resolved.element = inner.element;
      return {resolved, default: domainDefault};
    }
    current = next;
  }
  throw new Error(`type ${oid} is not a domain`);
}

/**
 * The resolved type of a column: base type, the domain chain (outermost first), every CHECK on the
 * chain, enum labels when the base is an enum, the element type of an array of domains or enums,
 * and whether a domain forbids NULL.
 *
 * @param {{type_oid: number, format: string}} column
 * @param {Map<number, object>} types
 * @returns {{resolved: ResolvedType, default: string | null}}
 */
export function resolveColumnType(column, types) {
  return (
    resolveType(column.type_oid, types) ?? {
      resolved: {base: column.format, domains: [], checks: [], not_null: false},
      default: null,
    }
  );
}

/** One fingerprinted column from a catalog row. */
export function buildColumn(column, types) {
  const {resolved, default: domainDefault} = resolveColumnType(column, types);
  const col = {
    name: column.name,
    type: column.format,
    resolved_type: resolved,
    nullable: !column.not_null && !resolved.not_null,
    default: column.default ?? domainDefault ?? null,
  };
  // `kind` rides along for the cross-check and is dropped when the table entry is built.
  return {...col, fingerprint: fingerprint(col), kind: column.kind ?? 'table'};
}

/**
 * Keep every table, and only the views a Haskell record reads from (views are otherwise out of
 * scope). `epoch` is the case in point: migration 2-0049 turned it into a view over
 * `epoch_finalized` and `epoch_current`, and the `Epoch` record still reads it.
 */
export function relevantRelations(tables, haskellTables) {
  return new Map(
    [...tables].filter(([name, rows]) => rows[0]?.kind !== 'view' || haskellTables.has(name)),
  );
}

/**
 * Every domain in the catalog that belongs to the db-sync schema, resolved.
 *
 * @returns {Record<string, ResolvedType>}
 */
export function buildDomains(types, schema = 'public') {
  const domains = {};
  const owned = [...types.values()]
    .filter((t) => t.kind === 'd' && t.schema === schema)
    .sort((a, b) => a.name.localeCompare(b.name));
  for (const domain of owned) domains[domain.name] = resolveDomain(domain.oid, types).resolved;
  return domains;
}

/**
 * Cross-check one variant's database tables against its Haskell tables. Returns readable problems;
 * an empty array means the two sides agree on tables, columns and nullability.
 */
export function crossCheck(variant, dbTables, haskellTables) {
  const problems = [];
  for (const [name, hs] of haskellTables) {
    const db = dbTables.get(name);
    if (!db) {
      problems.push(
        `[${variant}] ${hs.file}: ${hs.record} declares table ${name}, which the migrations never create`,
      );
      continue;
    }
    const dbColumns = new Map(db.map((c) => [c.name, c]));
    const hsColumns = new Map(hs.columns.map((c) => [c.column, c]));
    for (const c of hs.columns) {
      const dc = dbColumns.get(c.column);
      if (!dc) {
        problems.push(
          `[${variant}] ${name}.${c.column} (${hs.record}.${c.field}) is not in the database`,
        );
      } else if (dc.kind !== 'view' && dc.nullable !== c.nullable) {
        // A view column carries no NOT NULL in the catalog, so only tables can be compared.
        problems.push(
          `[${variant}] ${name}.${c.column}: database says ${dc.nullable ? 'NULL' : 'NOT NULL'}, ` +
            `${hs.record}.${c.field} says ${c.nullable ? 'Maybe' : 'not Maybe'}`,
        );
      }
    }
    for (const c of db) {
      if (c.name !== 'id' && !hsColumns.has(c.name)) {
        problems.push(`[${variant}] ${name}.${c.name} is in the database but not in ${hs.record}`);
      }
    }
  }
  return problems;
}

function annotateTable(name, columns, hs) {
  const byColumn = new Map((hs?.columns ?? []).map((c) => [c.column, c]));
  return {
    name,
    kind: columns[0]?.kind ?? 'table',
    haskell: hs ? {record: hs.record, file: hs.file} : null,
    columns: columns.map(({kind: _kind, ...c}) => {
      const h = byColumn.get(c.name);
      return h ? {...c, haskell: {field: h.field, ...(h.sqltype ? {sqltype: h.sqltype} : {})}} : c;
    }),
  };
}

/**
 * Merge both variants into one table list. A table identical in both (same columns, same
 * fingerprints, same Haskell record) appears once with `variant: "all"`; otherwise one entry per
 * variant that has it, tagged `core` or `address`.
 *
 * @param {{core: Map, address: Map}} dbTables variant → table name → built columns
 * @param {{core: Map, address: Map}} haskellTables variant → table name → Haskell table
 */
export function mergeVariants(dbTables, haskellTables) {
  const names = new Set([...dbTables.core.keys(), ...dbTables.address.keys()]);
  const tables = [];
  for (const name of [...names].sort()) {
    const entries = VARIANTS.filter((v) => dbTables[v].has(name)).map((v) => ({
      variant: v,
      ...annotateTable(name, dbTables[v].get(name), haskellTables[v].get(name)),
    }));
    if (
      entries.length === 2 &&
      canonicalJson(strip(entries[0])) === canonicalJson(strip(entries[1]))
    ) {
      tables.push({...entries[0], variant: 'all'});
    } else {
      tables.push(...entries);
    }
  }
  return tables;
}

function strip(entry) {
  const {variant: _variant, ...rest} = entry;
  return rest;
}

/**
 * The artifact, from catalog snapshots of both variants and the Haskell tables.
 *
 * @param {object} input
 * @param {{core: object, address: object}} input.catalogs `{types: Map, tables: Map<name, rows[]>,
 *   schemaVersion: {stage_one, stage_two, stage_three}}` per variant
 * @param {{core: Map, address: Map}} input.haskell Haskell tables per variant
 * @returns {{artifact: SchemaArtifact, problems: string[]}}
 */
export function buildArtifact({catalogs, haskell}) {
  const built = {};
  const problems = [];
  for (const v of VARIANTS) {
    const {types, tables} = catalogs[v];
    const kept = relevantRelations(tables, haskell[v]);
    built[v] = new Map(
      [...kept].map(([name, rows]) => [name, rows.map((r) => buildColumn(r, types))]),
    );
    problems.push(...crossCheck(v, built[v], haskell[v]));
  }
  const artifact = {
    schemaVersion: ARTIFACT_VERSION,
    postgres: POSTGRES_MAJOR,
    dbSchemaVersion: catalogs.core.schemaVersion,
    domains: buildDomains(catalogs.core.types),
    tables: mergeVariants(built, haskell),
  };
  return {artifact, problems};
}

/**
 * The columns that are typed through at least one domain.
 *
 * @param {SchemaArtifact} artifact
 */
export function domainTypedColumns(artifact) {
  return artifact.tables
    .flatMap((t) => t.columns)
    .filter((c) => c.resolved_type.domains.length > 0);
}

/**
 * Columns whose fingerprint differs between two artifacts, keyed `variant:table.column`. Columns
 * present on only one side are not counted: a drop or an add is not a contract change of the
 * column that survives.
 *
 * @param {SchemaArtifact} before
 * @param {SchemaArtifact} after
 * @returns {string[]}
 */
export function changedFingerprints(before, after) {
  /** @param {SchemaArtifact} artifact */
  const index = (artifact) =>
    new Map(
      artifact.tables.flatMap((t) =>
        t.columns.map((c) => [`${t.variant}:${t.name}.${c.name}`, c.fingerprint]),
      ),
    );
  const a = index(before);
  const b = index(after);
  return [...a].filter(([key, fp]) => b.has(key) && b.get(key) !== fp).map(([key]) => key);
}
