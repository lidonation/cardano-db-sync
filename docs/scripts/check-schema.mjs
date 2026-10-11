#!/usr/bin/env node
/**
 * SCH-1 / GDE-6 gate — the committed schema artifact is structurally sound and unedited.
 *
 * The artifact is produced by `scripts/extract-schema.mjs` against a replayed Postgres (B08); this
 * gate runs in the docs pipeline with no database and no Haskell toolchain present. It fails when
 * the committed JSON cannot be trusted: wrong version, unsorted or duplicated tables, a column whose
 * domain is left unresolved, a domain chain that names an unknown domain, a Haskell source path
 * that does not exist, or a fingerprint that no longer matches its column (a hand edit).
 *
 * Drift against a fresh extraction is the extract-schema workflow's job, not this script's.
 *
 * Run by `npm run check:schema` and by CI.
 */
import {existsSync, readFileSync} from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import {
  ARTIFACT_FILE,
  ARTIFACT_VERSION,
  POSTGRES_MAJOR,
  compareNames,
  fingerprint,
} from './lib/schema-model.mjs';

const VARIANT_ORDER = {all: 0, core: 1, address: 2};
const KINDS = new Set(['table', 'view']);

function checkResolvedType(where, resolved, domains, problems) {
  if (!resolved || typeof resolved.base !== 'string' || resolved.base.length === 0) {
    problems.push(`${where}: resolved_type.base is missing`);
    return;
  }
  const base = resolved.base.replace(/\[\]$/, '');
  if (base in domains)
    problems.push(`${where}: domain ${base} is unresolved (resolved_type.base names a domain)`);
  if (!Array.isArray(resolved.domains) || !Array.isArray(resolved.checks)) {
    problems.push(`${where}: resolved_type.domains and resolved_type.checks must be arrays`);
    return;
  }
  for (const name of resolved.domains) {
    if (!(name in domains)) problems.push(`${where}: domain chain names unknown domain ${name}`);
  }
  for (const check of resolved.checks) {
    if (!resolved.domains.includes(check?.domain) || typeof check?.definition !== 'string') {
      problems.push(`${where}: a CHECK is not attached to a domain on the chain`);
    }
  }
  if (typeof resolved.not_null !== 'boolean') {
    problems.push(`${where}: resolved_type.not_null must be a boolean`);
  }
  if (resolved.element !== undefined) {
    checkResolvedType(`${where} (element)`, resolved.element, domains, problems);
  }
}

/**
 * Every reason the committed artifact cannot be trusted, as readable lines. Empty means sound.
 *
 * @param {string} docsRoot the docs directory
 */
export function findProblems(docsRoot) {
  const repoRoot = path.resolve(docsRoot, '..');
  const file = path.join(docsRoot, ARTIFACT_FILE);
  if (!existsSync(file))
    return [`${ARTIFACT_FILE} is missing — run node scripts/extract-schema.mjs`];
  let artifact;
  try {
    artifact = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    return [`${ARTIFACT_FILE} is not valid JSON: ${error.message}`];
  }
  const problems = [];
  if (artifact.schemaVersion !== ARTIFACT_VERSION) {
    problems.push(`schemaVersion is ${artifact.schemaVersion}, expected ${ARTIFACT_VERSION}`);
  }
  if (artifact.postgres !== POSTGRES_MAJOR) {
    problems.push(`postgres is ${artifact.postgres}, expected ${POSTGRES_MAJOR}`);
  }
  const domains = artifact.domains ?? {};
  for (const [name, resolved] of Object.entries(domains)) {
    checkResolvedType(`domain ${name}`, resolved, domains, problems);
    if (resolved?.domains?.[0] !== name)
      problems.push(`domain ${name}: its chain must start with itself`);
  }
  if (!Array.isArray(artifact.tables) || artifact.tables.length === 0) {
    problems.push('tables is missing or empty');
    return problems;
  }
  const seen = new Map();
  let previous = null;
  for (const table of artifact.tables) {
    const label = `${table.name} [${table.variant}]`;
    if (!(table.variant in VARIANT_ORDER)) problems.push(`${label}: unknown variant`);
    if (!KINDS.has(table.kind)) problems.push(`${label}: unknown kind ${table.kind}`);
    if (previous) {
      const order =
        compareNames(previous.name, table.name) ||
        VARIANT_ORDER[previous.variant] - VARIANT_ORDER[table.variant];
      if (order >= 0) problems.push(`${label}: tables are not sorted by name, then variant`);
    }
    previous = table;
    const variants = seen.get(table.name) ?? [];
    if (variants.includes('all') || (table.variant === 'all' && variants.length > 0)) {
      problems.push(`${label}: a table tagged "all" cannot also appear per variant`);
    }
    seen.set(table.name, [...variants, table.variant]);
    if (table.haskell && !existsSync(path.join(repoRoot, table.haskell.file))) {
      problems.push(`${label}: Haskell source ${table.haskell.file} does not exist`);
    }
    if (!Array.isArray(table.columns) || table.columns.length === 0) {
      problems.push(`${label}: has no columns`);
      continue;
    }
    const names = new Set();
    for (const column of table.columns) {
      if (names.has(column.name)) problems.push(`${label}: column ${column.name} appears twice`);
      names.add(column.name);
      const where = `${table.name}.${column.name} [${table.variant}]`;
      checkResolvedType(where, column.resolved_type, domains, problems);
      if (typeof column.nullable !== 'boolean')
        problems.push(`${where}: nullable must be a boolean`);
      if (column.fingerprint !== fingerprint(column)) {
        problems.push(
          `${where}: fingerprint does not match the column (hand-edited?) — re-run the extraction`,
        );
      }
    }
  }
  return problems;
}

/**
 * Run the gate and report.
 *
 * @param {string} root the docs directory
 * @param {{log: (message: string) => void, error: (message: string) => void}} out reporter
 * @returns {number} the process exit code
 */
export function main(root, out) {
  const problems = findProblems(root);
  if (problems.length > 0) {
    out.error(`check:schema — ${ARTIFACT_FILE} failed ${problems.length} check(s):`);
    for (const problem of problems) out.error(`  ${problem}`);
    out.error('Regenerate it with: node scripts/extract-schema.mjs (needs Postgres 17).');
    return 1;
  }
  const artifact = JSON.parse(readFileSync(path.join(root, ARTIFACT_FILE), 'utf8'));
  const columns = artifact.tables.reduce((total, table) => total + table.columns.length, 0);
  out.log(
    `check:schema — version ${artifact.schemaVersion}, ${artifact.tables.length} tables, ` +
      `${columns} columns, ${Object.keys(artifact.domains).length} domains`,
  );
  return 0;
}

// Only run when invoked directly, so importing this module is side-effect free.
if (process.argv[1] === import.meta.filename) {
  process.exit(main(path.resolve(import.meta.dirname, '..'), console));
}
