#!/usr/bin/env node
/**
 * Asset budget gate — the built site stays inside its byte budget (PERF-1).
 *
 * Two measurements, both gzip-compressed bytes because that is what crosses the wire:
 *
 *   totals   every file in the build, grouped by kind (js, css, html, image, font, other)
 *   page     the initial payload of each HTML page: the page itself plus the stylesheets and
 *            scripts it references directly. The largest page is held to `page.initial`.
 *
 * Limits live in `config/asset-budget.json`. A kind the budget does not name is measured and
 * reported but not limited. Run by `npm run check:budget` after a build, and by CI. With no
 * arguments it checks every profile output under `build/`; pass build directories to check only
 * those.
 */
import {readFile, readdir} from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import {gzipSync} from 'node:zlib';

const ROOT = path.resolve(import.meta.dirname, '..');
const BUILD = path.join(ROOT, 'build');
const BUDGET_FILE = path.join(ROOT, 'config', 'asset-budget.json');

const KINDS = /** @type {const} */ ({
  '.js': 'js',
  '.mjs': 'js',
  '.css': 'css',
  '.html': 'html',
  '.svg': 'image',
  '.png': 'image',
  '.jpg': 'image',
  '.jpeg': 'image',
  '.gif': 'image',
  '.webp': 'image',
  '.avif': 'image',
  '.ico': 'image',
  '.woff': 'font',
  '.woff2': 'font',
  '.ttf': 'font',
  '.otf': 'font',
});

/** Stylesheets and scripts a page asks for before it can render. */
const INITIAL_ASSET =
  /<(?:link[^>]*\srel=["']?stylesheet["']?[^>]*\shref|script[^>]*\ssrc)=["']([^"']+)["']/gi;

/** @param {string} file */
export function kindOf(file) {
  return KINDS[/** @type {keyof typeof KINDS} */ (path.extname(file).toLowerCase())] ?? 'other';
}

/** @param {Buffer} bytes */
export function gzipSize(bytes) {
  return gzipSync(bytes, {level: 9}).length;
}

async function* walk(dir) {
  const entries = await readdir(dir, {withFileTypes: true});
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walk(full);
    } else if (entry.isFile()) {
      yield full;
    }
  }
}

/**
 * Measure one build output directory.
 *
 * @param {string} dir
 * @returns {Promise<{totals: Record<string, number>, pages: Array<{page: string, bytes: number}>}>}
 */
export async function measure(dir) {
  /** @type {Record<string, number>} */
  const totals = {};
  /** gzip size by build-relative POSIX path. */
  const sizes = new Map();
  const htmlFiles = [];

  for await (const full of walk(dir)) {
    const rel = path.relative(dir, full).split(path.sep).join('/');
    const size = gzipSize(await readFile(full));
    sizes.set(rel, size);
    const kind = kindOf(full);
    totals[kind] = (totals[kind] ?? 0) + size;
    if (kind === 'html') {
      htmlFiles.push(rel);
    }
  }

  const pages = [];
  for (const rel of htmlFiles) {
    const html = await readFile(path.join(dir, rel), 'utf8');
    const seen = new Set();
    let bytes = sizes.get(rel) ?? 0;
    for (const m of html.matchAll(INITIAL_ASSET)) {
      const asset = assetPath(m[1], sizes);
      if (asset !== null && !seen.has(asset)) {
        seen.add(asset);
        bytes += sizes.get(asset) ?? 0;
      }
    }
    pages.push({page: rel, bytes});
  }
  pages.sort((a, b) => b.bytes - a.bytes);

  return {totals, pages};
}

/**
 * Find the build file a page's asset URL names. The build's base path is not known here (ENV-1),
 * so the longest suffix of the URL path that names a file in the build wins.
 */
function assetPath(url, sizes) {
  if (/^[a-z]+:\/\//i.test(url) || url.startsWith('//')) {
    return null;
  }
  const parts = url.split(/[?#]/)[0].split('/').filter(Boolean);
  for (let i = 0; i < parts.length; i += 1) {
    const candidate = parts.slice(i).join('/');
    if (sizes.has(candidate)) {
      return candidate;
    }
  }
  return null;
}

/**
 * @typedef {{totals?: Record<string, number>, page?: {initial?: number}}} Budget
 *   Limits in gzip bytes.
 */

/**
 * Compare a measurement against a budget.
 *
 * @param {Awaited<ReturnType<typeof measure>>} measured
 * @param {Budget} budget
 * @returns {Array<{what: string, bytes: number, limit: number}>}
 */
export function overBudget(measured, budget) {
  const over = [];
  for (const [kind, limit] of Object.entries(budget.totals ?? {})) {
    const bytes = measured.totals[kind] ?? 0;
    if (bytes > limit) {
      over.push({what: `total ${kind}`, bytes, limit});
    }
  }
  const pageLimit = budget.page?.initial;
  if (pageLimit !== undefined) {
    for (const {page, bytes} of measured.pages) {
      if (bytes > pageLimit) {
        over.push({what: `initial payload of ${page}`, bytes, limit: pageLimit});
      }
    }
  }
  return over;
}

const kb = (bytes) => `${(bytes / 1024).toFixed(1)} KiB`;

async function profileOutputs(buildDir) {
  const entries = await readdir(buildDir, {withFileTypes: true});
  return entries
    .filter((e) => e.isDirectory())
    .map((e) => path.join(buildDir, e.name))
    .sort();
}

/**
 * @typedef {{log: (message: string) => void, error: (message: string) => void}} Reporter
 */

/**
 * Run the gate and report. Returns the process exit code: 0 within budget, 1 over budget or when
 * there is no build to check.
 *
 * @param {string[]} [dirs] Build output directories. Defaults to every profile under `build/`.
 * @param {Reporter} [out] Where the report goes.
 * @param {Budget} [budget] Limits. Defaults to `config/asset-budget.json`.
 * @returns {Promise<number>}
 */
export async function main(dirs = [], out = /** @type {Reporter} */ (console), budget) {
  const limits = budget ?? JSON.parse(await readFile(BUDGET_FILE, 'utf8'));
  let targets = dirs;
  if (targets.length === 0) {
    targets = await profileOutputs(BUILD).catch(() => []);
  }
  if (targets.length === 0) {
    out.error('check:budget - no build output found. Run `npm run build` first.');
    return 1;
  }

  let failed = 0;
  for (const dir of targets) {
    const name = path.relative(ROOT, dir) || dir;
    const measured = await measure(dir);
    const summary = Object.entries(measured.totals)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([kind, bytes]) => `${kind} ${kb(bytes)}`)
      .join(', ');
    const heaviest = measured.pages[0];
    out.log(`check:budget - ${name} (gzip): ${summary}`);
    if (heaviest) {
      out.log(`  heaviest page: ${heaviest.page}, initial payload ${kb(heaviest.bytes)}`);
    }

    const over = overBudget(measured, limits);
    failed += over.length;
    for (const o of over) {
      out.error(`  over budget: ${o.what} is ${kb(o.bytes)}, limit ${kb(o.limit)}`);
    }
  }

  if (failed > 0) {
    out.error(`check:budget - ${failed} budget(s) exceeded. Limits: config/asset-budget.json.`);
    return 1;
  }
  out.log('check:budget - within budget (PERF-1).');
  return 0;
}

if (process.argv[1] === import.meta.filename) {
  process.exitCode = await main(process.argv.slice(2).map((d) => path.resolve(d)));
}
