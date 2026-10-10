#!/usr/bin/env node
/**
 * VER-5 gate — the route manifest is append-only.
 *
 * `config/route-manifest.json` lists every route the site has ever published (the build writes
 * it; see plugins/route-manifest). An entry that disappears is a URL that will 404 forever, so
 * this gate compares the manifest with the same file at a base commit and fails, listing them, if
 * any route the base listed is missing now. Entries may change status (live → retired → live);
 * they may never be removed.
 *
 * The base is `MANIFEST_BASE_REF` (CI passes the PR base or the push's previous commit), else
 * `HEAD`, which catches an uncommitted deletion locally. Run by `npm run check:manifest` and CI.
 */
import {execFile} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import {promisify} from 'node:util';

const ROOT = path.resolve(import.meta.dirname, '..');
const MANIFEST = 'config/route-manifest.json';
const NULL_SHA = /^0+$/;

/**
 * Reads the manifest's routes at a commit. Resolves to null when the file did not exist there
 * (the manifest's own first commit). Rejects when the ref itself does not resolve, so a
 * misconfigured base never passes silently.
 *
 * @param {string} ref
 * @param {string} root
 * @returns {Promise<Record<string, unknown> | null>}
 */
export async function routesAt(ref, root = ROOT) {
  const git = promisify(execFile);
  try {
    await git('git', ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], {cwd: root});
  } catch {
    throw new Error(`base ref "${ref}" does not resolve to a commit (is history fetched?)`);
  }
  try {
    const {stdout} = await git('git', ['show', `${ref}:./${MANIFEST}`], {
      cwd: root,
      maxBuffer: 64 * 1024 * 1024,
    });
    return JSON.parse(stdout).routes ?? {};
  } catch (error) {
    if (/does not exist|exists on disk, but not in/.test(String(error))) {
      return null;
    }
    throw error;
  }
}

/**
 * The working-tree manifest's routes. A deleted manifest is every entry removed, so it reads as
 * empty and the gate lists them all, rather than reporting that it cannot run.
 *
 * @param {string} root
 * @returns {Promise<Record<string, unknown>>}
 */
export async function currentRoutes(root = ROOT) {
  let raw;
  try {
    raw = await readFile(path.join(root, MANIFEST), 'utf8');
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code === 'ENOENT') {
      return {};
    }
    throw error;
  }
  return JSON.parse(raw).routes ?? {};
}

/**
 * Routes listed at the base and missing now, sorted.
 *
 * @param {Record<string, unknown>} base
 * @param {Record<string, unknown>} current
 * @returns {string[]}
 */
export function findDeleted(base, current) {
  return Object.keys(base)
    .filter((route) => !Object.prototype.hasOwnProperty.call(current, route))
    .sort();
}

/**
 * @typedef {{log: (message: string) => void, error: (message: string) => void}} Reporter
 */

/**
 * Run the gate and report. Returns the process exit code: 0 clean, 1 on a deleted entry, 2 when
 * the gate cannot run.
 *
 * @param {{root?: string, env?: NodeJS.ProcessEnv, out?: Reporter}} [options]
 * @returns {Promise<number>}
 */
export async function main({
  root = ROOT,
  env = process.env,
  out = /** @type {Reporter} */ (console),
} = {}) {
  const ref = env.MANIFEST_BASE_REF?.trim() || 'HEAD';

  if (NULL_SHA.test(ref)) {
    out.log(`check:manifest - no base commit (${ref}); nothing to compare against.`);
    return 0;
  }

  let base;
  let current;
  try {
    base = await routesAt(ref, root);
    current = await currentRoutes(root);
  } catch (error) {
    out.error(`check:manifest - cannot run: ${error instanceof Error ? error.message : error}`);
    return 2;
  }

  if (base === null) {
    out.log(`check:manifest - ${MANIFEST} is new since ${ref}; nothing to compare against.`);
    return 0;
  }

  const deleted = findDeleted(base, current);
  if (deleted.length === 0) {
    out.log(
      `check:manifest - append-only holds: all ${Object.keys(base).length} route(s) listed at ` +
        `${ref} are still listed.`,
    );
    return 0;
  }

  out.error(`check:manifest - ${deleted.length} route(s) removed from ${MANIFEST} (VER-5):\n`);
  for (const route of deleted) {
    out.error(`  ${route}`);
  }
  out.error(
    '\nThe manifest is append-only: every published route must keep resolving. Restore the ' +
      'entries; a retired page is redirected by the build, not deleted from the manifest.',
  );
  return 1;
}

if (process.argv[1] === import.meta.filename) {
  process.exitCode = await main();
}
