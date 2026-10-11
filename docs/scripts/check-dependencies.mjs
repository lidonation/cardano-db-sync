#!/usr/bin/env node
/**
 * Dependency gate — installs are reproducible and the money path is pinned (SEC-5, SEC-6).
 *
 * SEC-5  Every direct dependency in package.json is an exact version, not a range, tag, URL or
 *        git reference, and `.npmrc` keeps `npm install` writing exact versions. The lockfile is
 *        committed and installs go through `npm ci`, which refuses a lockfile that disagrees with
 *        package.json, so its integrity hashes are what CI installs.
 * SEC-6  `config/review-gated-dependencies.json` lists the survey route's packages (CBOR, transaction
 *        construction, wallet interaction), each with the reason it is gated. A listed package that
 *        is installed at all must be a direct dependency at an exact version: one that arrives only
 *        through another package floats with that package's range.
 *
 * Run by `npm run check:deps` and by CI. Needs no network.
 */
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const ROOT = path.resolve(import.meta.dirname, '..');
export const REVIEW_GATED = 'config/review-gated-dependencies.json';

/** An exact semver version: `1.2.3`, `1.2.3-rc.1`. */
const EXACT = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

/** @typedef {{rule: string, message: string}} Problem */

/** SEC-5 problems in package.json, `.npmrc` and the lockfile. */
export function pinProblems(pkg, npmrc, lock) {
  /** @type {Problem[]} */
  const out = [];
  for (const field of ['dependencies', 'devDependencies', 'optionalDependencies']) {
    for (const [name, spec] of Object.entries(pkg[field] ?? {})) {
      if (!EXACT.test(String(spec))) {
        out.push({rule: 'SEC-5', message: `${field}.${name} is "${spec}", not an exact version`});
      }
    }
  }
  if (!/^\s*save-exact\s*=\s*true\s*$/m.test(npmrc ?? '')) {
    out.push({rule: 'SEC-5', message: '.npmrc does not set save-exact=true'});
  }
  if (lock === null) {
    out.push({rule: 'SEC-5', message: 'package-lock.json is missing'});
  } else if (!(lock.lockfileVersion >= 2) || !lock.packages) {
    out.push({rule: 'SEC-5', message: 'package-lock.json has no integrity-hashed "packages" map'});
  }
  return out;
}

/**
 * Whether the lockfile installs `name` anywhere in the tree.
 *
 * @param {{packages?: Record<string, unknown>} | null} lock
 * @param {string} name
 */
const installed = (lock, name) =>
  Object.keys(lock?.packages ?? {}).some(
    (key) => key === `node_modules/${name}` || key.endsWith(`/node_modules/${name}`),
  );

/**
 * SEC-6 problems: the list's shape, and each listed package's pin.
 *
 * @param {{packages?: unknown}} gated The parsed review-gated list.
 * @param {{dependencies?: Record<string, string>, devDependencies?: Record<string, string>}} pkg
 * @param {{lockfileVersion?: number, packages?: Record<string, unknown>} | null} [lock] The parsed lockfile, when there is one.
 */
export function reviewGateProblems(gated, pkg, lock = null) {
  /** @type {Problem[]} */
  const out = [];
  if (
    typeof gated.packages !== 'object' ||
    gated.packages === null ||
    Array.isArray(gated.packages)
  ) {
    return [{rule: 'SEC-6', message: `${REVIEW_GATED} has no "packages" object`}];
  }
  const direct = {...pkg.dependencies, ...pkg.devDependencies};
  for (const [name, entry] of Object.entries(gated.packages)) {
    if (typeof entry?.reason !== 'string' || entry.reason.trim() === '') {
      out.push({rule: 'SEC-6', message: `${name} is listed without a reason`});
    }
    if (name in direct && !EXACT.test(String(direct[name]))) {
      out.push({
        rule: 'SEC-6',
        message: `${name} is review-gated but "${direct[name]}" is not exact`,
      });
    } else if (!(name in direct) && installed(lock, name)) {
      out.push({
        rule: 'SEC-6',
        message: `${name} is installed but not a direct dependency, so package.json does not pin it`,
      });
    }
  }
  return out;
}

async function readOptional(file) {
  try {
    return await readFile(file, 'utf8');
  } catch {
    return null;
  }
}

/** @typedef {import('./lib/build-output.mjs').Reporter} Reporter */

/**
 * @param {{root?: string, out?: Reporter}} [options]
 * @returns {Promise<number>} 0 clean, 1 on a violation, 2 when package.json, the list or the
 *   lockfile is unreadable.
 */
export async function main({root = ROOT, out = /** @type {Reporter} */ (console)} = {}) {
  let pkg;
  let gated;
  let lock;
  try {
    pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
    gated = JSON.parse(await readFile(path.join(root, REVIEW_GATED), 'utf8'));
    const lockText = await readOptional(path.join(root, 'package-lock.json'));
    lock = lockText === null ? null : JSON.parse(lockText);
  } catch (error) {
    out.error(`check:deps - cannot run: ${error instanceof Error ? error.message : error}`);
    return 2;
  }
  const problems = [
    ...pinProblems(pkg, await readOptional(path.join(root, '.npmrc')), lock),
    ...reviewGateProblems(gated, pkg, lock),
  ];
  if (problems.length === 0) {
    const count = Object.keys(gated.packages).length;
    out.log(
      `check:deps - clean. Every dependency is pinned (SEC-5); ${count} review-gated (SEC-6).`,
    );
    return 0;
  }
  out.error(`check:deps - ${problems.length} violation(s):\n`);
  for (const p of problems) {
    out.error(`  ${p.rule}  ${p.message}`);
  }
  return 1;
}

if (process.argv[1] === import.meta.filename) {
  process.exitCode = await main();
}
