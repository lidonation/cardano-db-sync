#!/usr/bin/env node
/**
 * Publish gate — what the deploy job ships fits GitHub Pages (BLD-1).
 *
 * GitHub Pages refuses a published site over 1 GB and times a deployment out at 10 minutes. Both
 * are asserted by the deploy job, not hoped for:
 *
 *   size <dir>         before upload: the published tree's total bytes against the 1 GB limit;
 *   elapsed <seconds>  after the deploy: wall-clock time since the job started (Unix seconds)
 *                      against the 10-minute limit.
 *
 * Each reports its measurement, so every deploy records how close it came (B38 tightens these
 * into the specification's budget).
 */
import {stat} from 'node:fs/promises';
import process from 'node:process';

import {walk} from './lib/build-output.mjs';

/** GitHub Pages' published-site limit, in bytes. */
export const SIZE_LIMIT = 1_000_000_000;

/** GitHub Pages' deployment timeout, in seconds. */
export const TIME_LIMIT = 600;

/** Total size in bytes of every file under `dir`. */
export async function treeSize(dir) {
  let total = 0;
  for await (const file of walk(dir)) {
    total += (await stat(file)).size;
  }
  return total;
}

const mb = (bytes) => `${(bytes / 1_000_000).toFixed(1)} MB`;

/** @typedef {import('./lib/build-output.mjs').Reporter} Reporter */

/**
 * @param {string[]} args `size <dir>` or `elapsed <started-unix-seconds>`.
 * @param {{out?: Reporter, now?: number, limits?: {size: number, time: number}}} [options]
 * @returns {Promise<number>} 0 within the limit, 1 over it, 2 on bad arguments.
 */
export async function main(
  args,
  {
    out = /** @type {Reporter} */ (console),
    now = Date.now() / 1000,
    limits = {size: SIZE_LIMIT, time: TIME_LIMIT},
  } = {},
) {
  const [mode, value] = args;
  if (mode === 'size' && value) {
    let bytes;
    try {
      bytes = await treeSize(value);
    } catch (error) {
      out.error(
        `check:publish - cannot measure ${value}: ${error instanceof Error ? error.message : error}`,
      );
      return 2;
    }
    const line = `published tree ${mb(bytes)} of ${mb(limits.size)} (${((100 * bytes) / limits.size).toFixed(1)}%)`;
    if (bytes > limits.size) {
      out.error(`check:publish - over the Pages limit: ${line} (BLD-1)`);
      return 1;
    }
    out.log(`check:publish - ${line} (BLD-1)`);
    return 0;
  }
  if (mode === 'elapsed' && /^\d+$/.test(value ?? '')) {
    const seconds = Math.round(now - Number(value));
    const line = `deploy took ${seconds}s of ${limits.time}s`;
    if (seconds > limits.time) {
      out.error(`check:publish - over the Pages deploy timeout: ${line} (BLD-1)`);
      return 1;
    }
    out.log(`check:publish - ${line} (BLD-1)`);
    return 0;
  }
  out.error('usage: check-publish.mjs size <dir> | elapsed <started-unix-seconds>');
  return 2;
}

if (process.argv[1] === import.meta.filename) {
  process.exitCode = await main(process.argv.slice(2));
}
