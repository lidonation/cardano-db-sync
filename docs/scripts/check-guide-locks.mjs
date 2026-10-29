#!/usr/bin/env node
import {existsSync, lstatSync, readdirSync, readFileSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import * as prettier from 'prettier';
import {evaluateHistoricalGuide} from './lib/guide-locks.mjs';
import {unpackHistory} from './lib/guide-history.mjs';
import {canonicalJson} from './lib/schema-model.mjs';

const root = process.cwd();
const guidesDir = path.join(root, 'docs/guides');
const lockPath = path.join(root, 'generated/guide-locks.json');
const updating = process.argv.slice(2).includes('--update');
const schema = JSON.parse(readFileSync(path.join(root, 'generated/schema.json'), 'utf8'));
const config = JSON.parse(readFileSync(path.join(root, 'generated/config-schema.json'), 'utf8'));
const renamePath = path.join(root, 'generated/schema-renames.json');
const renames = existsSync(renamePath)
  ? JSON.parse(readFileSync(renamePath, 'utf8'))
  : {entities: []};
const old = existsSync(lockPath) ? JSON.parse(readFileSync(lockPath, 'utf8')) : null;
const isMap = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
if (
  !updating &&
  (!old ||
    old.schemaVersion !== 1 ||
    !isMap(old.guides) ||
    !isMap(old.ranges) ||
    !isMap(old.variants) ||
    JSON.stringify(Object.keys(old.guides).sort()) !==
      JSON.stringify(Object.keys(old.ranges).sort()) ||
    JSON.stringify(Object.keys(old.guides).sort()) !==
      JSON.stringify(Object.keys(old.variants).sort()) ||
    Object.values(old.variants).some(
      (entry) =>
        !isMap(entry) ||
        Object.values(entry).some(
          (values) => !Array.isArray(values) || values.some((value) => typeof value !== 'string'),
        ),
    ) ||
    Object.values(old.guides).some((entry) => !isMap(entry)) ||
    Object.values(old.ranges).some(
      (range) => !Array.isArray(range) || range.some((tag) => typeof tag !== 'string'),
    ))
) {
  console.error(
    'guide-locks.json is missing or invalid; run npm run guide-locks:update after review',
  );
  process.exit(1);
}
const files = [];
const filesystemErrors = [];
function walk(dir) {
  let stat;
  try {
    stat = lstatSync(dir);
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }
  if (stat.isSymbolicLink()) {
    filesystemErrors.push(`${path.relative(root, dir)}: guide symlink is not permitted`);
    return;
  }
  if (!stat.isDirectory()) {
    filesystemErrors.push(`${path.relative(root, dir)}: expected a guide directory`);
    return;
  }
  for (const entry of readdirSync(dir, {withFileTypes: true}).sort((a, b) =>
    a.name.localeCompare(b.name, 'en'),
  )) {
    const file = path.join(dir, entry.name);
    if (entry.isSymbolicLink())
      filesystemErrors.push(`${path.relative(root, file)}: guide symlink is not permitted`);
    else if (entry.isDirectory()) walk(file);
    else if (entry.isFile() && /\.mdx?$/.test(entry.name)) files.push(file);
  }
}
try {
  if (lstatSync(path.join(root, 'docs')).isSymbolicLink())
    filesystemErrors.push('docs: guide parent symlink is not permitted');
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
if (!filesystemErrors.length) walk(guidesDir);
const historyPath = path.join(root, 'generated/guide-history.json');
const versionsPath = path.join(root, 'generated/versions.json');
let history = [];
if (files.length) {
  if (!existsSync(historyPath) || !existsSync(versionsPath)) {
    console.error('guide history or release version data is unavailable');
    process.exit(1);
  }
  const artifact = JSON.parse(readFileSync(historyPath, 'utf8'));
  const releases = JSON.parse(readFileSync(versionsPath, 'utf8'));
  let extracted;
  try {
    extracted = unpackHistory(artifact);
  } catch (error) {
    console.error(`guide history invalid: ${error.message}`);
    process.exit(1);
  }
  if (
    !Array.isArray(releases.versions) ||
    !releases.versions.length ||
    JSON.stringify(extracted.map((entry) => entry.tag)) !==
      JSON.stringify(releases.versions.map((entry) => entry.tag))
  ) {
    console.error('guide history does not match release versions');
    process.exit(1);
  }
  history = [...extracted, {tag: 'current', schema, config}];
}
const next = {schemaVersion: 1, guides: {}, ranges: {}, variants: {}};
const problems = [...filesystemErrors];
const drift = new Map();
for (const file of files) {
  const name = path.relative(root, file).split(path.sep).join('/');
  const prior = old?.guides?.[name];
  if (!updating && !prior)
    problems.push(`${name}: no reviewed lock; run npm run guide-locks:update after review`);
  const result = evaluateHistoricalGuide(
    name,
    readFileSync(file, 'utf8'),
    history,
    updating ? undefined : prior,
    renames,
  );
  problems.push(...result.errors);
  for (const change of result.changes ?? []) {
    const signature = JSON.stringify(change);
    if (!drift.has(signature)) drift.set(signature, {change, guides: []});
    drift.get(signature).guides.push(name);
  }
  for (const warning of result.warnings) console.warn(`warning: ${warning}`);
  next.guides[name] = result.lock;
  next.ranges[name] = result.versions;
  next.variants[name] = result.variants ?? {};
  if (
    !updating &&
    canonicalJson(old.variants?.[name] ?? {}) !== canonicalJson(result.variants ?? {})
  )
    problems.push(`${name}: supported schema variants changed; update the lock after review`);
  if (!updating && JSON.stringify(old.ranges?.[name]) !== JSON.stringify(result.versions))
    problems.push(`${name}: derived version range changed; update the lock after review`);
}
if (!updating)
  for (const name of Object.keys(old.guides))
    if (!(name in next.guides))
      problems.push(`${name}: reviewed guide removed; update the lock after review`);
if (drift.size) {
  const details = Array.from(
    drift.values(),
    ({change, guides}) =>
      `  ${change.key} (${guides.join(', ')})\n    reviewed: ${JSON.stringify(change.reviewed)}\n    current:  ${JSON.stringify(change.current)}`,
  );
  problems.push(`Reviewed entity fingerprints changed (${drift.size}):\n${details.join('\n')}`);
}
if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
if (updating)
  writeFileSync(
    lockPath,
    await prettier.format(JSON.stringify(next), {
      ...(await prettier.resolveConfig(lockPath)),
      parser: 'json',
    }),
  );
console.log(`Guide locks ${updating ? 'updated' : 'verified'}: ${files.length} guides`);
