#!/usr/bin/env node
/**
 * CON-1 gate — the committed schema rename map (GDE-9) is structurally sound.
 *
 * The artifact is produced by `extract-renames` (B09) in the `extract-haddock` workflow, which also
 * fails on drift (CON-2). This gate runs in the docs pipeline with no Haskell toolchain present and
 * fails when the committed JSON cannot be consumed: wrong schema version, an unknown kind, a
 * migration file that does not exist under `schema/`, renames out of application order, a column or
 * constraint with no table, or entities that disagree with the renames they were built from.
 *
 * Run by `npm run check:renames` and by CI.
 */
import {existsSync, readFileSync} from 'node:fs';
import path from 'node:path';
import process from 'node:process';

/** Must match RENAMES_SCHEMA_VERSION in src/data/schema-renames.ts. */
const SCHEMA_VERSION = 1;

const ARTIFACT = 'generated/schema-renames.json';

const KINDS = new Set([
  'table',
  'column',
  'constraint',
  'sequence',
  'index',
  'view',
  'type',
  'domain',
]);

const OWNED = new Set(['column', 'constraint']);

const MIGRATION_FILE = /^migration-(\d+)-(\d{4})-\d{8}\.sql$/;

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const hasText = (value) => typeof value === 'string' && value.trim() !== '';

/** Application order: stage, then version, then source line. */
const order = (rename) => [rename.migration.stage, rename.migration.version, rename.line];

function compare(a, b) {
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) {
      return a[i] < b[i] ? -1 : 1;
    }
  }
  return 0;
}

/**
 * Every reason the committed artifact cannot be consumed, as readable lines. An empty array means
 * the artifact is sound.
 *
 * @param {string} docsRoot the docs directory; `schema/` lives one level up.
 */
export function findProblems(docsRoot) {
  const schemaRoot = path.resolve(docsRoot, '..', 'schema');
  const artifactPath = path.join(docsRoot, ARTIFACT);
  if (!existsSync(artifactPath)) {
    return [`${ARTIFACT} is missing — run extract-renames (the extract-haddock workflow)`];
  }
  let artifact;
  try {
    artifact = JSON.parse(readFileSync(artifactPath, 'utf8'));
  } catch (error) {
    return [`${ARTIFACT} is not valid JSON: ${error.message}`];
  }
  if (!isObject(artifact)) {
    return ['artifact must be an object'];
  }

  const problems = [];
  if (artifact.schemaVersion !== SCHEMA_VERSION) {
    problems.push(
      `schema version ${JSON.stringify(artifact.schemaVersion)} is not ${SCHEMA_VERSION}`,
    );
  }
  if (artifact.source !== 'schema') {
    problems.push(`source must be "schema", got ${JSON.stringify(artifact.source)}`);
  }
  if (!Array.isArray(artifact.renames) || !Array.isArray(artifact.entities)) {
    problems.push('renames and entities must be arrays');
    return problems;
  }

  const migrationProblem = (at, migration) => {
    if (!isObject(migration)) {
      return `${at}: migration must be an object`;
    }
    const match = typeof migration.file === 'string' ? MIGRATION_FILE.exec(migration.file) : null;
    if (!match) {
      return `${at}: ${JSON.stringify(migration.file)} is not a migration file name`;
    }
    if (Number(match[1]) !== migration.stage || Number(match[2]) !== migration.version) {
      return `${at}: stage/version ${migration.stage}/${migration.version} disagree with ${migration.file}`;
    }
    if (![1, 2, 3, 4].includes(migration.stage)) {
      return `${at}: unsupported migration stage ${migration.stage}`;
    }
    if (!existsSync(path.join(schemaRoot, migration.file))) {
      return `${at}: schema/${migration.file} does not exist`;
    }
    return null;
  };

  const shapeProblems = (at, item, nameFields) => {
    const found = [];
    if (!KINDS.has(item.kind)) {
      found.push(`${at}: unknown kind ${JSON.stringify(item.kind)}`);
    }
    for (const field of nameFields) {
      if (!hasText(item[field])) {
        found.push(`${at}: ${field} must be a non-empty string`);
      }
    }
    if (OWNED.has(item.kind) ? !hasText(item.table) : item.table !== undefined) {
      found.push(
        OWNED.has(item.kind)
          ? `${at}: a ${item.kind} must name its table`
          : `${at}: only columns and constraints carry a table`,
      );
    }
    return found;
  };

  // Renames: well-formed and in application order.
  const sound = [];
  let previous = null;
  artifact.renames.forEach((rename, index) => {
    const at = `renames[${index}]`;
    if (!isObject(rename)) {
      problems.push(`${at}: must be an object`);
      return;
    }
    const found = shapeProblems(at, rename, ['from', 'to']);
    const migration = migrationProblem(at, rename.migration);
    if (migration) {
      found.push(migration);
    }
    if (!Number.isInteger(rename.line) || rename.line < 1) {
      found.push(`${at}: line must be a positive integer`);
    }
    if (rename.from === rename.to) {
      found.push(`${at}: renames ${rename.from} to itself`);
    }
    problems.push(...found);
    if (found.length > 0) {
      return;
    }
    if (previous !== null && compare(order(previous), order(rename)) > 0) {
      problems.push(`${at}: renames must be in application order (stage, version, line)`);
    }
    previous = rename;
    sound.push(rename);
  });

  // Rebuild identities in statement order. Owner names move with table renames.
  const history = [];
  const statements = new Set();
  for (const rename of sound) {
    const statement = JSON.stringify(rename);
    if (statements.has(statement)) problems.push('duplicate rename statement');
    statements.add(statement);
    let entity = history.find(
      (item) =>
        item.kind === rename.kind && item.table === rename.table && item.name === rename.from,
    );
    if (!entity) {
      entity = {
        kind: rename.kind,
        ...(rename.table === undefined ? {} : {table: rename.table}),
        name: rename.from,
        formerNames: [],
      };
      history.push(entity);
    }
    entity.formerNames.push({name: rename.from, until: rename.migration});
    entity.name = rename.to;
    if (rename.kind === 'table') {
      for (const owned of history) {
        if (owned.table === rename.from) owned.table = rename.to;
      }
    }
  }
  const signature = (entity) =>
    JSON.stringify([
      entity.kind,
      entity.table,
      entity.name,
      (Array.isArray(entity.formerNames) ? entity.formerNames : []).map((former) => [
        former?.name,
        former?.until?.stage,
        former?.until?.version,
        former?.until?.file,
      ]),
    ]);
  if (
    artifact.entities.every(isObject) &&
    JSON.stringify(history.map(signature).sort()) !==
      JSON.stringify(artifact.entities.map(signature).sort())
  ) {
    problems.push(
      'entities disagree with rename history (final name, owner or ordered former names)',
    );
  }

  const aliases = new Map();
  for (const entity of history) {
    for (const name of new Set([entity.name, ...entity.formerNames.map((former) => former.name)])) {
      const key = JSON.stringify([entity.kind, entity.table, name]);
      if (aliases.has(key)) problems.push(`ambiguous ${entity.kind} name ${name}`);
      aliases.set(key, entity);
    }
  }

  // Entities: every former name is accounted for by exactly one rename.
  const latestTable = (table) => {
    let name = table;
    for (const rename of sound) {
      if (rename.kind === 'table' && rename.from === name) name = rename.to;
    }
    return name;
  };
  const claimKey = (kind, table, name, file) =>
    JSON.stringify([kind, latestTable(table), name, file]);
  const unclaimed = new Map();
  for (const rename of sound) {
    const key = claimKey(rename.kind, rename.table, rename.from, rename.migration.file);
    const items = unclaimed.get(key) ?? [];
    items.push(rename);
    unclaimed.set(key, items);
  }
  artifact.entities.forEach((entity, index) => {
    const at = `entities[${index}]`;
    if (!isObject(entity)) {
      problems.push(`${at}: must be an object`);
      return;
    }
    problems.push(...shapeProblems(at, entity, ['name']));
    if (!Array.isArray(entity.formerNames) || entity.formerNames.length === 0) {
      problems.push(`${at}: formerNames must be a non-empty array`);
      return;
    }
    entity.formerNames.forEach((former, formerIndex) => {
      const atFormer = `${at}.formerNames[${formerIndex}]`;
      if (!isObject(former) || !hasText(former.name)) {
        problems.push(`${atFormer}: must carry a name`);
        return;
      }
      const migration = migrationProblem(atFormer, former.until);
      if (migration) {
        problems.push(migration);
        return;
      }
      const key = claimKey(entity.kind, entity.table, former.name, former.until.file);
      const items = unclaimed.get(key);
      if (!items?.length) {
        problems.push(
          `${atFormer}: no rename of ${entity.kind} ${former.name} in ${former.until.file}`,
        );
      } else {
        items.pop();
      }
    });
  });
  for (const rename of [...unclaimed.values()].flat()) {
    problems.push(
      `rename of ${rename.kind} ${rename.from} in ${rename.migration.file} belongs to no entity`,
    );
  }
  return problems;
}

/**
 * Command-line entry point.
 *
 * @returns {number} the process exit code.
 */
export function main(docsRoot, output) {
  const problems = findProblems(docsRoot);
  if (problems.length > 0) {
    output.error(`check:renames — ${ARTIFACT} cannot be consumed:`);
    for (const problem of problems) {
      output.error(`  ${problem}`);
    }
    output.error('Regenerate it with extract-renames (docs/extractor) and commit the result.');
    return 1;
  }
  const artifact = JSON.parse(readFileSync(path.join(docsRoot, ARTIFACT), 'utf8'));
  output.log(
    `check:renames — ${artifact.renames.length} renames, ${artifact.entities.length} renamed entities, all consumable.`,
  );
  return 0;
}

// Only run when invoked directly, so importing this module is side-effect free.
if (process.argv[1] === import.meta.filename) {
  process.exitCode = main(path.resolve(import.meta.dirname, '..'), console);
}
