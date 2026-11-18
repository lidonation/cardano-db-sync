#!/usr/bin/env node
/** B18: replay stage-two/four boundaries, never guess changes from SQL text or FK names.
 * Domains (stage one) run in full as in B08. Runtime address conversion is labeled as runtime,
 * not assigned a fictitious migration boundary. The build reads only the committed result.
 */
import {readFileSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import * as prettier from 'prettier';
import {
  applyMigrations,
  applySql,
  createDatabase,
  dropDatabase,
  migrationFiles,
  queryValue,
  readCatalog,
  serverMajor,
} from './lib/schema-db.mjs';
import {catalogToTables} from './lib/guide-history.mjs';
import {readAddressVariantDdl, readHaskellTables, readRecords} from './lib/schema-haskell.mjs';
import {columnChanges} from './lib/schema-explorer.mjs';
const docs = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repo = path.resolve(docs, '..');
export const target = path.join(docs, 'generated/schema-explorer.json');
export function relationships(database, variant) {
  return JSON.parse(
    queryValue(
      database,
      `SELECT COALESCE(json_agg(row ORDER BY row.table, row.columns::text, row.target), '[]') FROM (
    SELECT src.relname AS table, dst.relname AS target,
      json_agg(sa.attname ORDER BY k.n) AS columns,
      json_agg(da.attname ORDER BY k.n) AS "targetColumns"
    FROM pg_constraint c JOIN pg_class src ON src.oid=c.conrelid
      JOIN pg_namespace ns ON ns.oid=src.relnamespace
      JOIN pg_class dst ON dst.oid=c.confrelid
      CROSS JOIN LATERAL unnest(c.conkey,c.confkey) WITH ORDINALITY AS k(s,d,n)
      JOIN pg_attribute sa ON sa.attrelid=src.oid AND sa.attnum=k.s
      JOIN pg_attribute da ON da.attrelid=dst.oid AND da.attnum=k.d
    WHERE c.contype='f' AND ns.nspname='public'
    GROUP BY c.oid,src.relname,dst.relname
  ) row`,
    ),
  ).map((row) => ({...row, variant, kind: 'foreign-key'}));
}
/** Logical joins come from record field types, never `_id` spelling; SQL FKs take precedence. */
export function typedRelationships(repo, variant, enforced) {
  const tables = readHaskellTables(repo, variant);
  const records = new Map([...tables.values()].map((t) => [`${t.record}Id`, t.table]));
  const result = [...enforced];
  for (const table of tables.values()) {
    const fields = readRecords(readFileSync(path.join(repo, table.file), 'utf8'), table.file, {
      includeTypes: true,
    }).get(table.record);
    for (const column of table.columns) {
      const type = fields
        .find((field) => field.field === column.field)
        .haskellType.replace(/[!()]/g, '')
        .replace(/^Maybe\s+/, '')
        .trim();
      const target = records.get(type);
      if (
        !target ||
        result.some(
          (r) =>
            r.table === table.table && r.columns.length === 1 && r.columns[0] === column.column,
        )
      )
        continue;
      result.push({
        kind: 'typed-key',
        table: table.table,
        columns: [column.column],
        target,
        targetColumns: ['id'],
        variant,
      });
    }
  }
  return result.sort((a, b) =>
    `${a.table}.${a.columns}` < `${b.table}.${b.columns}`
      ? -1
      : `${a.table}.${a.columns}` > `${b.table}.${b.columns}`
        ? 1
        : 0,
  );
}
export function extractExplorer() {
  const admin = process.env.SCHEMA_PG_ADMIN_DB || 'postgres';
  if (serverMajor(admin) !== 17) throw new Error('schema explorer requires Postgres 17');
  const renames = JSON.parse(
    readFileSync(path.join(docs, 'generated/schema-renames.json'), 'utf8'),
  );
  const schemaDir = path.join(repo, 'schema'),
    files = migrationFiles(schemaDir);
  const current = {
    stageTwo: Math.max(...files.filter((f) => f.stage === 2).map((f) => f.version)),
    stageFour: Math.max(...files.filter((f) => f.stage === 4).map((f) => f.version)),
  };
  const result = {schemaVersion: 1, current, changes: {}, relationships: []};
  const name = `schema_explorer_${process.pid}_${Date.now()}`;
  createDatabase(admin, name);
  try {
    applyMigrations(
      name,
      schemaDir,
      files.filter((f) => f.stage === 1),
    );
    let previous = [];
    for (const file of files.filter((f) => f.stage === 2 || f.stage === 3 || f.stage === 4)) {
      applyMigrations(name, schemaDir, [file]);
      const tables = catalogToTables(readCatalog(name), 'core');
      const version = JSON.parse(queryValue(name, 'SELECT row_to_json(v) FROM schema_version v'));
      const at = {stageTwo: version.stage_two, stageFour: file.stage === 4 ? file.version : 0};
      for (const {table, column, before, after} of columnChanges(previous, tables, renames)) {
        const key = `core:${table}.${column}`;
        (result.changes[key] ??= []).push({at, migration: file.name, before, after});
      }
      previous = tables;
    }
    result.relationships.push(...typedRelationships(repo, 'core', relationships(name, 'core')));
    // Build the address variant with B08's own replay order (conversion before stage four).
  } finally {
    dropDatabase(admin, name);
  }
  const addressDb = `${name}_address`;
  createDatabase(admin, addressDb);
  try {
    applyMigrations(
      addressDb,
      schemaDir,
      files.filter((f) => f.stage < 4),
    );
    const before = catalogToTables(readCatalog(addressDb), 'core');
    for (const sql of readAddressVariantDdl(repo)) applySql(addressDb, sql);
    applyMigrations(
      addressDb,
      schemaDir,
      files.filter((f) => f.stage === 4 && f.version !== 1),
    );
    const after = catalogToTables(readCatalog(addressDb), 'address');
    const conversion = columnChanges(before, after, renames);
    // Shared definitions render from core history. Only B08's address-only definitions get an
    // address history; columns the conversion leaves alone inherit the core events.
    const addressOnly = new Set(
      JSON.parse(readFileSync(path.join(docs, 'generated/schema.json'), 'utf8'))
        .tables.filter((table) => table.variant === 'address')
        .map((table) => table.name),
    );
    for (const {table} of conversion) addressOnly.add(table);
    for (const [key, changes] of Object.entries(result.changes))
      if (addressOnly.has(key.slice('core:'.length).split('.')[0]))
        result.changes[key.replace(/^core:/, 'address:')] = changes;
    for (const {table, column, before: old, after: value} of conversion) {
      const key = `address:${table}.${column}`;
      result.changes[key] = [
        ...(result.changes[key] ?? []),
        {at: current, migration: 'runtime:tx_out.use_address_table', before: old, after: value},
      ];
    }
    result.relationships.push(
      ...typedRelationships(repo, 'address', relationships(addressDb, 'address')),
    );
  } finally {
    dropDatabase(admin, addressDb);
  }
  return result;
}
export async function main(argv = process.argv.slice(2), destination = target) {
  const text = await prettier.format(JSON.stringify(extractExplorer()), {
    ...(await prettier.resolveConfig(target)),
    filepath: target,
  });
  if (argv.includes('--check')) {
    if (readFileSync(destination, 'utf8') !== text)
      throw new Error('schema-explorer.json drift; run npm run extract:explorer');
    console.log('Schema explorer history/relationships regenerate byte-identically.');
  } else {
    writeFileSync(destination, text);
    console.log('Wrote schema-explorer.json');
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await main();
