#!/usr/bin/env node
/**
 * Link gate — every internal link in the built site resolves (BLD-3).
 *
 * Docusaurus already throws on broken links between routes it knows about. This gate checks the
 * emitted HTML itself, so it also catches what Docusaurus never sees: static assets, hand-written
 * `href`s in pages and components, and fragments that point at an id the target page lacks.
 *
 * External links are not fetched: a network-dependent gate would fail on someone else's outage.
 *
 * The site's origin and base path are read from the build's own `sitemap.xml` (its shortest
 * `<loc>` is the home page), so the gate names no environment value (ENV-1).
 *
 * Run by `npm run check:links` after a build, and by CI. With no arguments it checks every profile
 * output under `build/`; pass build directories to check only those.
 */
import {readFile, readdir, stat} from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import {URL} from 'node:url';

const ROOT = path.resolve(import.meta.dirname, '..');
const BUILD = path.join(ROOT, 'build');

/** Attributes that carry a URL the browser will request or navigate to. */
const URL_ATTRIBUTE = /\s(?:href|src)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;

/** Every element id, plus `name` on anchors, both valid fragment targets. */
const ID_ATTRIBUTE = /\s(?:id|name)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;

/** Schemes that are not documents in this build. */
const IGNORED_SCHEME = /^(?:mailto|tel|javascript|data|blob):/i;

/**
 * Read the site's origin and base path from `sitemap.xml`.
 *
 * @param {string} dir Build output directory.
 * @returns {Promise<{origin: string, base: string}>}
 */
export async function siteRoot(dir) {
  const xml = await readFile(path.join(dir, 'sitemap.xml'), 'utf8');
  const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => new URL(m[1]));
  if (locs.length === 0) {
    throw new Error(`${dir}/sitemap.xml lists no pages`);
  }
  const home = locs.reduce((a, b) => (b.pathname.length < a.pathname.length ? b : a));
  const base = home.pathname.endsWith('/') ? home.pathname : `${home.pathname}/`;
  return {origin: home.origin, base};
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

async function isFile(target) {
  try {
    return (await stat(target)).isFile();
  } catch {
    return false;
  }
}

/**
 * Map a URL path inside the site to the file that serves it, the way a static host does:
 * the exact file, then `<path>/index.html`, then `<path>.html`.
 *
 * @returns {Promise<string | null>}
 */
async function resolveFile(dir, sitePath) {
  const local = path.join(dir, ...sitePath.split('/').filter(Boolean));
  const candidates = sitePath.endsWith('/')
    ? [path.join(local, 'index.html')]
    : [local, path.join(local, 'index.html'), `${local}.html`];
  for (const candidate of candidates) {
    if (await isFile(candidate)) {
      return candidate;
    }
  }
  return null;
}

function lineAt(text, offset) {
  let line = 1;
  for (let i = 0; i < offset; i += 1) {
    if (text[i] === '\n') {
      line += 1;
    }
  }
  return line;
}

function decodeEntities(value) {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

/**
 * Check one build output directory.
 *
 * @param {string} dir Build output directory (one profile).
 * @returns {Promise<Array<{file: string, line: number, url: string, message: string}>>}
 */
export async function findBrokenLinks(dir) {
  const {origin, base} = await siteRoot(dir);
  const violations = [];
  /** @type {Map<string, Set<string>>} */
  const idCache = new Map();

  async function idsOf(file) {
    if (!idCache.has(file)) {
      const html = await readFile(file, 'utf8');
      const ids = new Set();
      for (const m of html.matchAll(ID_ATTRIBUTE)) {
        ids.add(decodeEntities(m[1] ?? m[2]));
      }
      idCache.set(file, ids);
    }
    return /** @type {Set<string>} */ (idCache.get(file));
  }

  for await (const full of walk(dir)) {
    if (path.extname(full) !== '.html') {
      continue;
    }
    const html = await readFile(full, 'utf8');
    const rel = path.relative(dir, full).split(path.sep).join('/');
    // The URL this page is served at, so relative links resolve the way a browser resolves them.
    const pageUrl = new URL(
      base + rel.replace(/(^|\/)index\.html$/, '$1').replace(/\.html$/, ''),
      origin,
    );

    for (const m of html.matchAll(URL_ATTRIBUTE)) {
      const raw = decodeEntities((m[1] ?? m[2]).trim());
      if (raw === '' || IGNORED_SCHEME.test(raw)) {
        continue;
      }

      let url;
      try {
        url = new URL(raw, pageUrl);
      } catch {
        violations.push({file: rel, line: lineAt(html, m.index), url: raw, message: 'malformed'});
        continue;
      }
      if (url.origin !== origin) {
        continue;
      }

      const report = (message) =>
        violations.push({file: rel, line: lineAt(html, m.index), url: raw, message});

      const pathname = decodeURIComponent(url.pathname);
      if (!`${pathname}/`.startsWith(base)) {
        report(`outside the site base path ${base}`);
        continue;
      }

      const target = await resolveFile(dir, pathname.slice(base.length - 1));
      if (target === null) {
        report('no file in the build serves this path');
        continue;
      }

      const fragment = decodeURIComponent(url.hash.slice(1));
      if (fragment !== '' && target.endsWith('.html') && !(await idsOf(target)).has(fragment)) {
        report(`no element with id "${fragment}" on the target page`);
      }
    }
  }

  return violations;
}

/** Profile outputs under `build/`: each subdirectory that holds a sitemap. */
async function profileOutputs(buildDir) {
  const entries = await readdir(buildDir, {withFileTypes: true});
  const dirs = [];
  for (const entry of entries) {
    const dir = path.join(buildDir, entry.name);
    if (entry.isDirectory() && (await isFile(path.join(dir, 'sitemap.xml')))) {
      dirs.push(dir);
    }
  }
  return dirs.sort();
}

/**
 * @typedef {{log: (message: string) => void, error: (message: string) => void}} Reporter
 */

/**
 * Run the gate and report. Returns the process exit code: 0 clean, 1 on any broken link or when
 * there is no build to check.
 *
 * @param {string[]} [dirs] Build output directories. Defaults to every profile under `build/`.
 * @param {Reporter} [out] Where the report goes.
 * @returns {Promise<number>}
 */
export async function main(dirs = [], out = /** @type {Reporter} */ (console)) {
  let targets = dirs;
  if (targets.length === 0) {
    targets = await profileOutputs(BUILD).catch(() => []);
  }
  if (targets.length === 0) {
    out.error('check:links - no build output found. Run `npm run build` first.');
    return 1;
  }

  let failed = 0;
  for (const dir of targets) {
    const name = path.relative(ROOT, dir) || dir;
    const violations = await findBrokenLinks(dir);
    if (violations.length === 0) {
      out.log(`check:links - ${name} clean. Every internal link resolves.`);
      continue;
    }
    failed += violations.length;
    out.error(`check:links - ${name}: ${violations.length} broken link(s):\n`);
    for (const v of violations) {
      out.error(`  ${v.file}:${v.line}  ${v.url}`);
      out.error(`    ${v.message}`);
    }
  }
  return failed === 0 ? 0 : 1;
}

if (process.argv[1] === import.meta.filename) {
  process.exitCode = await main(process.argv.slice(2).map((d) => path.resolve(d)));
}
