/**
 * B08 — replay db-sync's migrations into a throwaway Postgres and read back the catalog.
 *
 * Migrations are applied the way db-sync applies them (Cardano.Db.Migration.applyMigration):
 * `psql --single-transaction -v ON_ERROR_STOP=on`, files in lexical order, stages 1–4, with the
 * address variant skipping 4-0001 (`filterIndexesFull`) and then running the runtime DDL from
 * `updateTxOutAndCreateAddress`.
 *
 * Connection settings come from the standard libpq environment (PGHOST, PGPORT, PGUSER,
 * PGPASSWORD). Nothing here is used by the site build: the docs pipeline only reads the committed
 * artifact.
 */
import {spawnSync} from 'node:child_process';
import {readdirSync} from 'node:fs';
import path from 'node:path';

const MIGRATION_FILE = /^migration-([1-4])-(\d{4})-\d{8}\.sql$/;

/** The official migration files, parsed and in db-sync's lexical order. */
export function migrationFiles(schemaDir) {
  return readdirSync(schemaDir)
    .filter((name) => MIGRATION_FILE.test(name))
    .sort()
    .map((name) => {
      const [, stage, version] = MIGRATION_FILE.exec(name);
      return {name, stage: Number(stage), version: Number(version)};
    });
}

/**
 * The files one replay applies.
 *
 * @param {Array<{name: string, stage: number, version: number}>} files from `migrationFiles`
 * @param {'core' | 'address'} variant
 * @param {{stage: number, version: number}} [upTo] stop after this stage-N version (later stages
 *   are skipped); used to rebuild a historical schema, e.g. `{stage: 2, version: 29}`.
 */
export function selectMigrations(files, variant, upTo) {
  return files.filter((f) => {
    if (variant === 'address' && f.stage === 4 && f.version === 1) return false;
    if (!upTo) return true;
    return f.stage < upTo.stage || (f.stage === upTo.stage && f.version <= upTo.version);
  });
}

function run(args, input) {
  const result = spawnSync('psql', ['--no-psqlrc', '--quiet', '-v', 'ON_ERROR_STOP=on', ...args], {
    encoding: 'utf8',
    input,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) throw new Error(`psql could not start: ${result.error.message}`);
  if (result.status !== 0) {
    throw new Error(`psql ${args.join(' ')} failed:\n${result.stderr.trim()}`);
  }
  return result.stdout;
}

/** Run SQL and return the single text value it prints. */
export function queryValue(database, sql) {
  return run(['--tuples-only', '--no-align', '-d', database, '-c', sql]).trim();
}

/** The server's major version (17 for 17.x). */
export function serverMajor(database) {
  return Math.floor(Number(queryValue(database, 'SHOW server_version_num')) / 10000);
}

export function createDatabase(adminDb, name) {
  run(['-d', adminDb, '-c', `CREATE DATABASE "${name}"`]);
}

export function dropDatabase(adminDb, name) {
  run(['-d', adminDb, '-c', `DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`]);
}

/** Apply migration files in order, each in its own transaction, stopping on the first error. */
export function applyMigrations(database, schemaDir, files) {
  for (const f of files) {
    run(['--single-transaction', '-d', database, '-f', path.join(schemaDir, f.name)]);
  }
}

/** Run a block of SQL in one transaction. */
export function applySql(database, sql) {
  run(['--single-transaction', '-d', database], sql);
}

const CATALOG_SQL = `
WITH types AS (
  SELECT t.oid::int AS oid, t.typname AS name, n.nspname AS schema, t.typtype AS kind,
         t.typbasetype::int AS base_oid,
         CASE WHEN t.typtype = 'd' THEN format_type(t.typbasetype, t.typtypmod) END AS base_format,
         t.typnotnull AS not_null,
         t.typdefault AS "default",
         COALESCE((SELECT json_agg(pg_get_constraintdef(c.oid) ORDER BY pg_get_constraintdef(c.oid))
                   FROM pg_constraint c WHERE c.contypid = t.oid AND c.contype = 'c'), '[]') AS checks,
         COALESCE((SELECT json_agg(e.enumlabel ORDER BY e.enumsortorder)
                   FROM pg_enum e WHERE e.enumtypid = t.oid), '[]') AS labels
  FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
  WHERE t.typtype IN ('d', 'e')
), columns AS (
  SELECT c.relname AS "table", CASE c.relkind WHEN 'v' THEN 'view' ELSE 'table' END AS kind,
         a.attnum AS position, a.attname AS name,
         a.atttypid::int AS type_oid, NULLIF(t.typelem, 0)::int AS elem_oid,
         format_type(a.atttypid, a.atttypmod) AS format,
         a.attnotnull AS not_null,
         pg_get_expr(d.adbin, d.adrelid) AS "default"
  FROM pg_attribute a
  JOIN pg_class c ON c.oid = a.attrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  JOIN pg_type t ON t.oid = a.atttypid
  LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
  WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v') AND a.attnum > 0 AND NOT a.attisdropped
)
SELECT json_build_object(
  'types', (SELECT COALESCE(json_agg(types ORDER BY oid), '[]') FROM types),
  'columns', (SELECT COALESCE(json_agg(columns ORDER BY "table", position), '[]') FROM columns),
  'schemaVersion', (SELECT row_to_json(v) FROM (
    SELECT stage_one, stage_two, stage_three FROM schema_version) v)
)`;

/**
 * The catalog of one replayed database: `{types: Map<oid, row>, tables: Map<name, rows[]>,
 * schemaVersion}`, relations and columns in a deterministic order. Views are included (each column
 * row carries `kind`); the model keeps only the views a Haskell record reads from.
 */
export function readCatalog(database) {
  const raw = JSON.parse(queryValue(database, CATALOG_SQL));
  const tables = new Map();
  for (const column of raw.columns) {
    if (!tables.has(column.table)) tables.set(column.table, []);
    tables.get(column.table).push(column);
  }
  return {
    types: new Map(raw.types.map((t) => [t.oid, t])),
    tables,
    schemaVersion: raw.schemaVersion,
  };
}
