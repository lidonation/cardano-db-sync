#!/usr/bin/env node
/**
 * DF-11 / DF-1 gate — `src/css/tokens.css` is generated, never hand-edited.
 *
 * Re-runs the generator (`design/tools/tokens-to-css.py`) on `design/tokens.source.json` and fails
 * when the committed `tokens.css` differs from a fresh run, listing the first lines that differ.
 * Fix by editing the source and running `npm run tokens`. Run by `npm run check:tokens` and CI.
 */
import {execFile} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import {promisify} from 'node:util';

const ROOT = path.resolve(import.meta.dirname, '..');
export const SOURCE = 'design/tokens.source.json';
export const GENERATOR = 'design/tools/tokens-to-css.py';
export const OUTPUT = 'src/css/tokens.css';

/** Lines differ: first `limit` mismatches as {line, committed, generated}. */
export function firstDifferences(committed, generated, limit = 5) {
  const a = committed.split('\n');
  const b = generated.split('\n');
  const out = [];
  for (let i = 0; i < Math.max(a.length, b.length) && out.length < limit; i += 1) {
    if (a[i] !== b[i]) {
      out.push({
        line: i + 1,
        committed: a[i] ?? '<end of file>',
        generated: b[i] ?? '<end of file>',
      });
    }
  }
  return out;
}

/** @typedef {import('./lib/build-output.mjs').Reporter} Reporter */

/**
 * Run the gate and report. Returns the process exit code: 0 in sync, 1 on drift, 2 when the
 * generator cannot run.
 *
 * @param {{root?: string, python?: string, out?: Reporter}} [options]
 * @returns {Promise<number>}
 */
export async function main({
  root = ROOT,
  python = process.env.PYTHON || 'python3',
  out = /** @type {Reporter} */ (console),
} = {}) {
  let generated;
  let committed;
  try {
    ({stdout: generated} = await promisify(execFile)(python, [GENERATOR, SOURCE], {
      cwd: root,
      maxBuffer: 16 * 1024 * 1024,
    }));
    committed = await readFile(path.join(root, OUTPUT), 'utf8');
  } catch (error) {
    const detail = /** @type {{stderr?: string}} */ (error).stderr?.trim() || String(error);
    out.error(`check:tokens - cannot run the generator: ${detail}`);
    return 2;
  }

  if (generated === committed) {
    out.log(`check:tokens - ${OUTPUT} regenerates byte-identically from ${SOURCE}.`);
    return 0;
  }

  out.error(`check:tokens - ${OUTPUT} does not match a fresh run of ${GENERATOR}:\n`);
  for (const d of firstDifferences(committed, generated)) {
    out.error(`  line ${d.line}`);
    out.error(`    committed: ${d.committed}`);
    out.error(`    generated: ${d.generated}`);
  }
  out.error(`\n${OUTPUT} is generated. Edit ${SOURCE}, then run \`npm run tokens\`.`);
  return 1;
}

if (process.argv[1] === import.meta.filename) {
  process.exitCode = await main();
}
