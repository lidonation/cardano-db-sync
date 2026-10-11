#!/usr/bin/env node
/**
 * Audit gate — no known high or critical vulnerability ships unreviewed (SEC-5).
 *
 * Runs `npm audit` over the whole lockfile, dev dependencies included: the threat SEC-4 names is a
 * compromised package baked into the bundle at build time, and the build runs the dev tree too.
 *
 * An advisory at or above `high` fails the gate unless `config/audit-allowlist.json` lists it with
 * a reason and an expiry date. The list cannot rot quietly: an entry past its expiry fails, and so
 * does an entry whose advisory npm no longer reports, so the exception is removed as soon as the
 * fix lands. Moderate and low advisories are reported, not gated.
 *
 * Run by `npm run check:audit` and by CI. It needs the npm registry.
 */
import {execFile} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import {promisify} from 'node:util';

const ROOT = path.resolve(import.meta.dirname, '..');
export const ALLOWLIST = 'config/audit-allowlist.json';

const SEVERITY = ['info', 'low', 'moderate', 'high', 'critical'];
export const GATED = 'high';

/** @typedef {{id: string, package: string, severity: string, title: string, range: string}} Advisory */
/** @typedef {{id: string, package: string, reason: string, expires: string}} Exception */

/** The id an advisory is allowlisted by: its GHSA id, the last segment of the advisory URL. */
const advisoryId = (via) => via.url.split('/').pop();

/**
 * Every distinct advisory in `npm audit --json` output, once per (id, package).
 *
 * @returns {Advisory[]}
 */
export function advisories(report) {
  const seen = new Map();
  for (const vuln of Object.values(report.vulnerabilities ?? {})) {
    // `via` mixes advisories (objects) with the names of vulnerable packages it depends on.
    for (const via of vuln.via) {
      if (typeof via !== 'object') {
        continue;
      }
      const advisory = {
        id: advisoryId(via),
        package: via.name,
        severity: via.severity,
        title: via.title,
        range: via.range,
      };
      seen.set(`${advisory.id} ${advisory.package}`, advisory);
    }
  }
  return [...seen.values()].sort((a, b) => a.id.localeCompare(b.id));
}

const atLeast = (severity, floor) => SEVERITY.indexOf(severity) >= SEVERITY.indexOf(floor);

/** Shape-check the allowlist. Throws on an entry missing its reason, package or expiry. */
export function parseAllowlist(raw) {
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed.advisories)) {
    throw new Error(`${ALLOWLIST} has no "advisories" array`);
  }
  return parsed.advisories.map((entry, i) => {
    for (const key of ['id', 'package', 'reason', 'expires']) {
      if (typeof entry[key] !== 'string' || entry[key].trim() === '') {
        throw new Error(`${ALLOWLIST}: advisory ${i} needs a non-empty "${key}"`);
      }
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.expires)) {
      throw new Error(`${ALLOWLIST}: ${entry.id} expires "${entry.expires}", not YYYY-MM-DD`);
    }
    return /** @type {Exception} */ (entry);
  });
}

/**
 * Compare the audit with the allowlist on `today` (YYYY-MM-DD).
 *
 * @param {Advisory[]} found
 * @param {Exception[]} allowed
 */
export function evaluate(found, allowed, today) {
  const key = (a) => `${a.id} ${a.package}`;
  const allowedKeys = new Map(allowed.map((e) => [key(e), e]));
  const foundKeys = new Set(found.map(key));
  const gated = found.filter((a) => atLeast(a.severity, GATED));
  return {
    unreviewed: gated.filter((a) => !allowedKeys.has(key(a))),
    expired: allowed.filter((e) => foundKeys.has(key(e)) && e.expires < today),
    stale: allowed.filter((e) => !foundKeys.has(key(e))),
    accepted: gated.filter((a) => allowedKeys.has(key(a))),
    reported: found.filter((a) => !atLeast(a.severity, GATED)),
  };
}

/**
 * `npm audit --json`. npm exits 1 whenever it finds anything, so the exit code is not the verdict:
 * a report on stdout is, unless the report is npm's own error (no lockfile, registry down).
 *
 * @param {string} cwd
 * @param {(file: string, args: string[], options: object) => Promise<{stdout: string}>} [exec]
 */
export async function runAudit(cwd, exec = promisify(execFile)) {
  try {
    const {stdout} = await exec('npm', ['audit', '--json'], {
      cwd,
      maxBuffer: 64 * 1024 * 1024,
    });
    return JSON.parse(stdout);
  } catch (error) {
    const stdout = /** @type {{stdout?: string}} */ (error).stdout;
    if (stdout) {
      const report = JSON.parse(stdout);
      if (!report.error) {
        return report;
      }
      throw new Error(`npm audit failed: ${report.error.summary}`);
    }
    throw error;
  }
}

/** @typedef {import('./lib/build-output.mjs').Reporter} Reporter */

/**
 * @param {{root?: string, out?: Reporter, today?: string, report?: object}} [options]
 *   `report` replaces the `npm audit` run (tests).
 * @returns {Promise<number>} 0 clean, 1 on a gated finding, 2 when the audit cannot run.
 */
export async function main({
  root = ROOT,
  out = /** @type {Reporter} */ (console),
  today = new Date().toISOString().slice(0, 10),
  report,
} = {}) {
  let allowed;
  let found;
  try {
    allowed = parseAllowlist(await readFile(path.join(root, ALLOWLIST), 'utf8'));
    found = advisories(report ?? (await runAudit(root)));
  } catch (error) {
    out.error(`check:audit - cannot run: ${error instanceof Error ? error.message : error}`);
    return 2;
  }
  const result = evaluate(found, allowed, today);
  const line = (a) => `  ${a.id}  ${a.package}  ${a.severity}  ${a.title}`;

  if (result.reported.length > 0) {
    out.log(`check:audit - ${result.reported.length} advisory(ies) below ${GATED}, not gated:`);
    result.reported.forEach((a) => out.log(line(a)));
  }
  if (result.accepted.length > 0) {
    out.log(
      `check:audit - ${result.accepted.length} ${GATED}+ advisory(ies) accepted in ${ALLOWLIST}.`,
    );
  }
  const failures = result.unreviewed.length + result.expired.length + result.stale.length;
  if (failures === 0) {
    out.log(`check:audit - clean. No unreviewed ${GATED} or critical advisory (SEC-5).`);
    return 0;
  }
  if (result.unreviewed.length > 0) {
    out.error(`check:audit - ${result.unreviewed.length} ${GATED}+ advisory(ies) not reviewed:`);
    result.unreviewed.forEach((a) => out.error(line(a)));
    out.error(`  Upgrade, or add a reasoned, dated entry to ${ALLOWLIST} after review.`);
  }
  for (const e of result.expired) {
    out.error(
      `check:audit - ${e.id} (${e.package}) was accepted until ${e.expires}: review it again.`,
    );
  }
  for (const e of result.stale) {
    out.error(
      `check:audit - ${e.id} (${e.package}) is no longer reported: remove it from ${ALLOWLIST}.`,
    );
  }
  return 1;
}

if (process.argv[1] === import.meta.filename) {
  process.exitCode = await main();
}
