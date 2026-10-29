#!/usr/bin/env node
/** Derive the retained release/schema matrix from tag trees, never migration dates. */
import {execFileSync} from 'node:child_process';
import {readFileSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {deriveVersions, selectReleaseTags} from './lib/version-derivation.mjs';

const docs = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repo = path.resolve(docs, '..');
const artifact = path.join(docs, 'generated/versions.json');
const git = (...args) => execFileSync('git', args, {cwd: repo, encoding: 'utf8'});
const tags = selectReleaseTags(git('tag', '--list').trim().split('\n'));
if (!tags.length) throw new Error('No release tags found; fetch tags before extracting versions');
const versions = deriveVersions(tags, (tag) =>
  git('ls-tree', '-r', '--name-only', `refs/tags/${tag}`, '--', 'schema/').trim().split('\n'),
);
const output = `${JSON.stringify({version: 1, versions}, null, 2)}\n`;
if (process.argv.includes('--check')) {
  if (readFileSync(artifact, 'utf8') !== output)
    throw new Error('Version artifact drifted; run npm run extract:versions with all tags fetched');
  console.log('Version artifact is current');
} else {
  writeFileSync(artifact, output);
  console.log(`Wrote ${versions.length} release versions`);
}
