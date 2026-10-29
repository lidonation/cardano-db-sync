#!/usr/bin/env node
/** Extract each release's actual schema and config, never infer history from today's definitions. */
import {execFileSync} from 'node:child_process';
import {existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
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
import {readAddressVariantDdl} from './lib/schema-haskell.mjs';
import {
  buildHistory,
  catalogToTables,
  historyReplayPlan,
  packHistory,
  validRelease,
} from './lib/guide-history.mjs';

const root = process.cwd();
const repo = path.resolve(root, '..');
const target = path.join(root, 'generated/guide-history.json');
const releases = JSON.parse(
  readFileSync(path.join(root, 'generated/versions.json'), 'utf8'),
).versions;
const extractor =
  process.env.CONFIG_EXTRACTOR_BIN ||
  execFileSync('cabal', ['list-bin', 'exe:extract-config'], {
    cwd: path.join(root, 'extractor'),
    encoding: 'utf8',
  }).trim();
if (serverMajor('postgres') !== 17) throw new Error('guide history requires Postgres 17');
function replayRelease(dir, variant, tag) {
  const database = `guide_history_${variant}_${process.pid}_${Date.now()}`;
  const schemaDir = path.join(dir, 'schema');
  const plan = historyReplayPlan(selectMigrations(migrationFiles(schemaDir), variant), tag);
  createDatabase('postgres', database);
  try {
    for (const step of plan) {
      applyMigrations(database, schemaDir, step.files);
      if (step.variantAfter && variant === 'address')
        for (const sql of readAddressVariantDdl(dir)) applySql(database, sql);
    }
    return readCatalog(database);
  } finally {
    dropDatabase('postgres', database);
  }
}
const dir = mkdtempSync(path.join(os.tmpdir(), 'guide-history-'));
let output;
try {
  const artifact = buildHistory(releases, (release) => {
    if (!validRelease(release)) throw new Error(`invalid release metadata: ${release.tag}`);
    rmSync(dir, {recursive: true, force: true});
    execFileSync('mkdir', ['-p', dir]);
    const archive = execFileSync(
      'git',
      [
        'archive',
        release.tag,
        'schema',
        'cardano-db',
        'cardano-db-sync/src/Cardano/DbSync/Config.hs',
        'cardano-db-sync/src/Cardano/DbSync/Config/Types.hs',
      ],
      {cwd: repo, maxBuffer: 256 * 1024 * 1024},
    );
    execFileSync('tar', ['-xf', '-', '-C', dir], {input: archive});
    // These are standalone SQL tests, not db-sync migrations. Reject other unexpected SQL files.
    for (const file of ['test-referential-integrity.sql', 'test-uniqueness.sql'])
      rmSync(path.join(dir, 'schema', file), {force: true});
    const releaseFiles = migrationFiles(path.join(dir, 'schema'));
    const latestStageFour = Math.max(
      0,
      ...releaseFiles.filter((file) => file.stage === 4).map((file) => file.version),
    );
    if (latestStageFour !== Number(release.stage_four))
      throw new Error(`${release.tag}: stage four does not match versions.json`);
    const variants = ['core'];
    if (existsSync(path.join(dir, 'cardano-db/src/Cardano/Db/Statement/ConsumedTxOut.hs')))
      variants.push('address');
    const tables = [];
    for (const variant of variants) {
      const catalog = replayRelease(dir, variant, release.tag);
      if (catalog.schemaVersion.stage_two !== Number(release.stage_two))
        throw new Error(`${release.tag}: replayed stage two does not match versions.json`);
      tables.push(...catalogToTables(catalog, variant));
    }
    const configFile = path.join(dir, 'config.json');
    execFileSync(extractor, ['--repo-root', dir, '--out', configFile], {stdio: 'pipe'});
    const config = JSON.parse(readFileSync(configFile, 'utf8'));
    if (config.unresolved?.length) throw new Error(`${release.tag}: unresolved configuration`);
    console.log(`Extracted ${release.tag}: ${tables.length} tables`);
    return {tag: release.tag, schema: {tables}, config};
  });
  output = await prettier.format(JSON.stringify(packHistory(artifact)), {
    ...(await prettier.resolveConfig(target)),
    parser: 'json',
  });
} finally {
  rmSync(dir, {recursive: true, force: true});
}
if (process.argv.includes('--check')) {
  if (!existsSync(target) || readFileSync(target, 'utf8') !== output) {
    console.error('guide history differs from the release tags; regenerate it');
    process.exit(1);
  }
  console.log('Guide history is current');
} else {
  writeFileSync(target, output);
  console.log(`Wrote ${target}`);
}
