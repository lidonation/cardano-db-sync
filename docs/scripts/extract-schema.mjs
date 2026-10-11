#!/usr/bin/env node
/**
 * B08 (SCH-1, GDE-6) — extract the db-sync schema with column fingerprints.
 *
 * Replays every migration in `schema/` into two throwaway Postgres databases (the core and the
 * address tx_out variants), reads each column's resolved type, nullability and default from the
 * catalog, resolves domains transitively, cross-checks every table and column against the Haskell
 * `DbInfo` records, and writes `docs/generated/schema.json`.
 *
 * Needs a Postgres 17 server reachable through the libpq environment (PGHOST, PGPORT, PGUSER,
 * PGPASSWORD) and `psql` on PATH. CI provides both in the extract-schema workflow; the site build
 * never runs this script, it only reads the committed artifact.
 *
 * Usage:
 *   node scripts/extract-schema.mjs           # regenerate generated/schema.json
 *   node scripts/extract-schema.mjs --check   # fail if the committed artifact has drifted
 *
 * Optional: SCHEMA_PG_ADMIN_DB (default `postgres`) is the database used to create and drop the
 * throwaway ones.
 */
import {readFileSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {performance} from 'node:perf_hooks';
import process from 'node:process';
import {fileURLToPath} from 'node:url';

import * as prettier from 'prettier';

import {
  applyMigrations,
  applySql,
  createDatabase,
  dropDatabase,
  migrationFiles,
  readCatalog,
  selectMigrations,
  serverMajor,
} from './lib/schema-db.mjs';
import {readAddressVariantDdl, readHaskellTables} from './lib/schema-haskell.mjs';
import {ARTIFACT_FILE, POSTGRES_MAJOR, VARIANTS, buildArtifact} from './lib/schema-model.mjs';

const docsRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(docsRoot, '..');

/**
 * Replay one variant into a fresh database and return its catalog. The database is dropped
 * afterwards whatever happens.
 *
 * @param {object} options
 * @param {'core' | 'address'} options.variant
 * @param {{stage: number, version: number}} [options.upTo] rebuild a historical schema
 * @param {string} [options.adminDb]
 * @param {string} [options.repo] repository root
 */
export function replayCatalog({variant, upTo, adminDb = 'postgres', repo = repoRoot}) {
  const schemaDir = path.join(repo, 'schema');
  const name = `dbsync_schema_${variant}_${process.pid}_${Date.now()}`;
  createDatabase(adminDb, name);
  try {
    applyMigrations(name, schemaDir, selectMigrations(migrationFiles(schemaDir), variant, upTo));
    if (variant === 'address') {
      for (const block of readAddressVariantDdl(repo)) applySql(name, block);
    }
    return readCatalog(name);
  } finally {
    dropDatabase(adminDb, name);
  }
}

/**
 * Extract the artifact object and the cross-check problems, without judging them. A historical
 * replay (`upTo`) is expected to disagree with today's Haskell records.
 *
 * @param {{upTo?: {stage: number, version: number}, adminDb?: string, repo?: string}} [options]
 * @returns {{artifact: import('../src/data/schema').SchemaArtifact, problems: string[]}}
 */
export function extractArtifact({
  upTo,
  adminDb = process.env.SCHEMA_PG_ADMIN_DB || 'postgres',
  repo = repoRoot,
} = {}) {
  const major = serverMajor(adminDb);
  if (major !== POSTGRES_MAJOR) {
    throw new Error(
      `Postgres ${major} found; the artifact is extracted with Postgres ${POSTGRES_MAJOR} so that ` +
        'catalog rendering, and therefore regeneration, stays byte-identical',
    );
  }
  const catalogs = {};
  const haskell = {};
  for (const variant of VARIANTS) {
    catalogs[variant] = replayCatalog({variant, upTo, adminDb, repo});
    haskell[variant] = readHaskellTables(repo, variant);
  }
  return buildArtifact({catalogs, haskell});
}

/**
 * Extract the artifact for the current schema. Throws with every cross-check problem listed when
 * the Haskell records and the migrations disagree.
 *
 * @param {{adminDb?: string, repo?: string}} [options]
 * @returns {import('../src/data/schema').SchemaArtifact}
 */
export function extract(options = {}) {
  const {artifact, problems} = extractArtifact(options);
  if (problems.length > 0) {
    throw new Error(
      `The Haskell schema records and the migrations disagree (${problems.length}):\n` +
        problems.map((p) => `  - ${p}`).join('\n'),
    );
  }
  return artifact;
}

/**
 * The artifact as committed: JSON formatted by the repository's own prettier config.
 *
 * @param {object} artifact
 * @returns {Promise<string>}
 */
export async function serialize(artifact) {
  const file = path.join(docsRoot, ARTIFACT_FILE);
  const options = (await prettier.resolveConfig(file)) ?? {};
  return prettier.format(JSON.stringify(artifact), {...options, filepath: file});
}

/**
 * Extract and write (or, with `--check`, compare against) the committed artifact.
 *
 * @param {string[]} argv command-line arguments
 * @param {{log: (message: string) => void, error: (message: string) => void}} out reporter
 * @param {string} [target] the artifact path (defaults to the committed one)
 * @returns {Promise<number>} the process exit code
 */
export async function main(argv, out, target = path.join(docsRoot, ARTIFACT_FILE)) {
  const check = argv.includes('--check');
  const started = performance.now();
  const artifact = extract();
  const text = await serialize(artifact);
  const columns = artifact.tables.reduce((n, t) => n + t.columns.length, 0);
  const summary =
    `${artifact.tables.length} tables, ${columns} columns, ${Object.keys(artifact.domains).length} domains ` +
    `in ${((performance.now() - started) / 1000).toFixed(1)}s`;
  if (check) {
    let committed = '';
    try {
      committed = readFileSync(target, 'utf8');
    } catch {
      // A missing artifact is drift too.
    }
    if (committed !== text) {
      out.error(`${ARTIFACT_FILE} has drifted from a fresh extraction (${summary}).`);
      out.error('Regenerate it with: node scripts/extract-schema.mjs');
      return 1;
    }
    out.log(`No drift: ${ARTIFACT_FILE} matches a fresh extraction (${summary}).`);
    return 0;
  }
  writeFileSync(target, text);
  out.log(`Wrote ${ARTIFACT_FILE}: ${summary}.`);
  return 0;
}

// Only run when invoked directly, so importing this module is side-effect free.
if (process.argv[1] === import.meta.filename) {
  try {
    process.exit(await main(process.argv.slice(2), console));
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
