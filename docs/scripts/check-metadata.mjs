#!/usr/bin/env node
/** B21: CI validates every built public page, not a hand-picked sample. */
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {load} from 'cheerio';
import {metadataProblems} from './lib/metadata-validation.mjs';
import {profileOutputs, walk} from './lib/build-output.mjs';
const ROOT = path.resolve(import.meta.dirname, '..');

export async function checkMetadata(dir) {
  const errors = [];
  let count = 0;
  for await (const file of walk(dir)) {
    if (!file.endsWith('.html') || path.basename(file) === '404.html') continue;
    const html = await readFile(file, 'utf8');
    if (load(html)('meta[http-equiv="refresh"]').length) continue;
    count++;
    errors.push(...metadataProblems(html).map((error) => `${path.relative(dir, file)}: ${error}`));
  }
  if (!count) errors.push('no public HTML pages found');
  return {count, errors};
}
/** @param {string[]} targets @param {import('./lib/build-output.mjs').Reporter} out */
export async function main(targets = [], out = console) {
  if (!targets.length) targets = await profileOutputs(path.join(ROOT, 'build'));
  if (!targets.length) {
    out.error('check:metadata - no build output');
    return 1;
  }
  let failed = false;
  for (const dir of targets) {
    const result = await checkMetadata(dir);
    if (result.errors.length) {
      failed = true;
      out.error(result.errors.join('\n'));
    } else out.log(`check:metadata - ${dir}: ${result.count} public pages valid (META-10)`);
  }
  return failed ? 1 : 0;
}
if (process.argv[1] === import.meta.filename)
  process.exitCode = await main(process.argv.slice(2).map((dir) => path.resolve(dir)));
