#!/usr/bin/env node
/**
 * CSP gate — the built site does only what its Content-Security-Policy allows (SEC-1..SEC-3).
 *
 * The policy is written into each page by `plugins/security`. This gate reads the emitted files
 * and fails where a browser would refuse something, or where the policy itself drifted:
 *
 *   - every page carries exactly one meta policy, ahead of any script, stylesheet or style;
 *   - the policy is SEC-2's, with nothing loosened: no `unsafe-*`, no host, no wildcard, no
 *     directive a meta policy ignores (SEC-1); `script-src` adds only hashes and, on the survey
 *     route, extension schemes (SEC-8);
 *   - every inline script the page executes is covered by a hash in its policy (SEC-3);
 *   - no inline style attribute or `<style>` element, which `style-src 'self'` refuses;
 *   - no external origin in any resource the page or a stylesheet loads, and no `data:` font
 *     (SEC-2). Links a person follows (`<a href>`) are navigation, not loads, and are not checked.
 *
 * Run by `npm run check:csp` after a build, and by CI. With no arguments it checks every profile
 * output under `build/`; pass build directories to check only those.
 */
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import {lineIndex, profileOutputs, walk} from './lib/build-output.mjs';
import {SCRIPT, hashSource, isInlineExecutable} from './lib/csp.mjs';

export {hashSource};

const ROOT = path.resolve(import.meta.dirname, '..');
const BUILD = path.join(ROOT, 'build');

/** SEC-2's directives. `script-src` may add hashes (and, on the survey route, extensions). */
export const EXPECTED = {
  'default-src': "'self'",
  'script-src': "'self'",
  'style-src': "'self'",
  'img-src': "'self' data:",
  'font-src': "'self'",
  'connect-src': "'self'",
  'object-src': "'none'",
  'base-uri': "'none'",
};

const HASH_SOURCE = /^'sha256-[A-Za-z0-9+/]+=*'$/;
const EXTENSION_SOURCE = /^(?:chrome|moz)-extension:$/;
/** The survey page, at the root or under a locale directory (`fr/`, `pt-BR/`). */
const SURVEY_FILE = /^(?:[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*\/)?survey(?:\/|$)/;

const META = /<meta\s+http-equiv=["']?Content-Security-Policy["']?\s+content="([^"]*)"\s*\/?>/gi;

/** An opening tag, attribute values with `>` in them included. */
const TAG = /<([a-z][a-z0-9-]*)\b((?:[^>"']|"[^"]*"|'[^']*')*)>/gi;

/** One attribute: double-quoted, single-quoted, unquoted or bare. */
const ATTRIBUTE = /([^\s=/>"']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

/** Attributes that make the browser fetch something, on any element. */
const RESOURCE_ATTRIBUTES = new Set(['src', 'srcset', 'poster', 'data', 'imagesrcset']);

/** SVG elements whose `href` is fetched, not followed. */
const SVG_FETCHING_HREF = new Set(['image', 'use', 'feimage', 'script']);

/** `<link rel>` values that fetch the target. Anything else (`canonical`, `alternate`) is a name. */
const FETCHING_RELS =
  /\b(?:stylesheet|preload|modulepreload|prefetch|preconnect|dns-prefetch|icon|manifest|apple-touch-icon)\b/i;

const EXTERNAL = /^(?:[a-z][a-z0-9+.-]*:)?\/\//i;

/** @typedef {{file: string, line: number, rule: string, message: string}} Violation */

/**
 * A tag's attributes, lower-cased names to values, first occurrence winning as in a browser.
 *
 * @param {string} source
 */
export function parseAttributes(source) {
  const attributes = new Map();
  for (const m of source.matchAll(ATTRIBUTE)) {
    const name = m[1].toLowerCase();
    if (!attributes.has(name)) {
      attributes.set(name, m[2] ?? m[3] ?? m[4] ?? '');
    }
  }
  return attributes;
}

/**
 * Whether the browser fetches this attribute of this element. `<a href>` and the like are
 * navigation, and a `<link>` fetches only for the `rel` values that load something.
 */
function fetches(tag, name, attributes) {
  if (RESOURCE_ATTRIBUTES.has(name)) {
    return true;
  }
  if (name !== 'href' && name !== 'xlink:href') {
    return false;
  }
  return tag === 'link'
    ? FETCHING_RELS.test(attributes.get('rel') ?? '')
    : SVG_FETCHING_HREF.has(tag);
}

/** Parse a policy string into `directive → sources`. */
export function parsePolicy(policy) {
  const directives = new Map();
  for (const part of policy.split(';')) {
    const [name, ...sources] = part.trim().split(/\s+/);
    if (name) {
      directives.set(name.toLowerCase(), sources);
    }
  }
  return directives;
}

/** Problems with a policy itself, for the page at `file` (relative to the build root). */
export function policyProblems(policy, file) {
  const directives = parsePolicy(policy);
  const problems = [];
  for (const name of directives.keys()) {
    if (!(name in EXPECTED)) {
      problems.push(`unexpected directive ${name} (SEC-1/SEC-2)`);
    }
  }
  for (const [name, want] of Object.entries(EXPECTED)) {
    const got = directives.get(name);
    if (!got) {
      problems.push(`missing ${name} (SEC-2)`);
      continue;
    }
    if (name !== 'script-src') {
      if (got.join(' ') !== want) {
        problems.push(`${name} is "${got.join(' ')}", expected "${want}" (SEC-2)`);
      }
      continue;
    }
    if (got[0] !== "'self'") {
      problems.push(`script-src must start with 'self' (SEC-2)`);
    }
    for (const source of got.slice(1)) {
      if (HASH_SOURCE.test(source)) {
        continue;
      }
      if (EXTENSION_SOURCE.test(source) && SURVEY_FILE.test(file)) {
        continue;
      }
      problems.push(`script-src allows ${source} (SEC-2, SEC-8)`);
    }
  }
  return problems;
}

/** Every violation in one HTML page. */
export function findPageViolations(file, html) {
  const lineAt = lineIndex(html);
  /** @type {Violation[]} */
  const out = [];
  const add = (index, rule, message) => out.push({file, line: lineAt(index), rule, message});

  const metas = [...html.matchAll(META)];
  if (metas.length !== 1) {
    add(0, 'SEC-1', `${metas.length} Content-Security-Policy meta tags, expected exactly 1`);
    return out;
  }
  const meta = metas[0];
  const firstLoad = html.search(/<(?:script|link|style)\b/i);
  if (firstLoad !== -1 && firstLoad < meta.index) {
    add(firstLoad, 'SEC-1', 'a script, stylesheet or style comes before the policy');
  }
  for (const problem of policyProblems(meta[1], file)) {
    add(meta.index, 'SEC-2', problem);
  }

  const scriptSrc = parsePolicy(meta[1]).get('script-src') ?? [];
  for (const m of html.matchAll(SCRIPT)) {
    if (!isInlineExecutable(m[1])) {
      continue;
    }
    if (!scriptSrc.includes(hashSource(m[2]))) {
      add(
        m.index,
        'SEC-3',
        `inline script not covered by a hash in script-src: ${m[2].slice(0, 60)}`,
      );
    }
  }

  for (const m of html.matchAll(/<style\b|\sstyle\s*=\s*["']/gi)) {
    add(
      m.index,
      'SEC-2',
      `inline style, which style-src 'self' refuses: ${html.slice(m.index, m.index + 50).trim()}`,
    );
  }

  for (const m of html.matchAll(TAG)) {
    const tag = m[1].toLowerCase();
    const attributes = parseAttributes(m[2]);
    for (const [name, value] of attributes) {
      if (!fetches(tag, name, attributes)) {
        continue;
      }
      for (const url of value.split(',').map((u) => u.trim().split(/\s+/)[0])) {
        if (EXTERNAL.test(url)) {
          add(m.index, 'SEC-2', `<${tag} ${name}> loads from another origin: ${url}`);
        }
      }
    }
  }
  return out;
}

/** Every violation in one stylesheet: external loads and inlined fonts. */
export function findStylesheetViolations(file, css) {
  const lineAt = lineIndex(css);
  /** @type {Violation[]} */
  const out = [];
  for (const m of css.matchAll(/(?:url\(\s*["']?|@import\s+["'])([^"')\s]+)/gi)) {
    if (EXTERNAL.test(m[1])) {
      out.push({
        file,
        line: lineAt(m.index),
        rule: 'SEC-2',
        message: `loads from another origin: ${m[1]}`,
      });
    } else if (/^data:(?:font\/|application\/(?:x-)?font)/i.test(m[1])) {
      out.push({
        file,
        line: lineAt(m.index),
        rule: 'SEC-2',
        message: "a data: font, which font-src 'self' refuses",
      });
    }
  }
  return out;
}

/** Every violation in a build output directory. */
export async function findViolations(dir) {
  /** @type {Violation[]} */
  const out = [];
  let pages = 0;
  for await (const full of walk(dir)) {
    const file = path.relative(dir, full).split(path.sep).join('/');
    if (file.endsWith('.html')) {
      pages += 1;
      out.push(...findPageViolations(file, await readFile(full, 'utf8')));
    } else if (file.endsWith('.css')) {
      out.push(...findStylesheetViolations(file, await readFile(full, 'utf8')));
    }
  }
  if (pages === 0) {
    throw new Error('no HTML pages');
  }
  return out;
}

/** @typedef {import('./lib/build-output.mjs').Reporter} Reporter */

/**
 * Check each build output and report. Returns the process exit code: 0 clean, 1 otherwise.
 *
 * @param {string[]} [dirs] Build output directories. Defaults to every profile under `build/`.
 * @param {Reporter} [out]
 * @param {string} [buildDir] Where to look for profile outputs when `dirs` is empty.
 * @returns {Promise<number>}
 */
export async function main(dirs = [], out = /** @type {Reporter} */ (console), buildDir = BUILD) {
  const targets =
    dirs.length > 0 ? dirs.map((d) => path.resolve(d)) : await profileOutputs(buildDir);
  if (targets.length === 0) {
    out.error('check:csp - no build output found. Run `npm run build` first.');
    return 1;
  }
  let failed = 0;
  for (const dir of targets) {
    const name = path.relative(ROOT, dir) || dir;
    let violations;
    try {
      violations = await findViolations(dir);
    } catch (error) {
      failed += 1;
      out.error(`check:csp - ${name}: ${error instanceof Error ? error.message : error}`);
      continue;
    }
    if (violations.length === 0) {
      out.log(`check:csp - ${name} clean. SEC-1, SEC-2 and SEC-3 hold on every page.`);
      continue;
    }
    failed += violations.length;
    out.error(`check:csp - ${name}: ${violations.length} violation(s):\n`);
    for (const v of violations) {
      out.error(`  ${v.file}:${v.line}  ${v.rule}  ${v.message}`);
    }
  }
  return failed === 0 ? 0 : 1;
}

if (process.argv[1] === import.meta.filename) {
  process.exitCode = await main(process.argv.slice(2));
}
