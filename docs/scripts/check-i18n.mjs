#!/usr/bin/env node
/**
 * i18n gate — only the current line goes to Crowdin (VER-2).
 *
 * Older lines freeze at whatever they were translated to, so i18n cost follows release churn,
 * not the size of the version window. `crowdin.yml` is the only thing that decides what Crowdin
 * sees, so this gate reads it and checks:
 *
 *   - credentials come from the environment (`project_id_env`, `api_token_env`), never the file;
 *   - every translation path is per-locale, and docs translate into `current/` only;
 *   - no source pattern reaches a released line: `versioned_docs/`, `versioned_sidebars/`, or a
 *     `version-*` docs translation or label file. This is checked against probe paths, so it
 *     holds before the first release line exists, and against every file in the tree;
 *   - the sources do reach the current docs and UI strings, so the sync is not silently empty;
 *   - no export fills a gap with English: UI strings skip untranslated strings and docs skip
 *     untranslated files, because the site treats "exists for the locale" as "translated"
 *     (A11Y-18, META-4).
 *
 * Run by `npm run check:i18n` and by CI. Needs no network.
 */
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import yaml from 'js-yaml';

import {SKIP_DIRS, walk} from './lib/build-output.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
export const CONFIG = 'crowdin.yml';

/** Paths on a released line. None of them may be a Crowdin source. */
export const OLD_LINE_PROBES = [
  '/versioned_docs/version-13.6/intro.md',
  '/versioned_docs/version-13.6/guides/restore.mdx',
  '/versioned_sidebars/version-13.6-sidebars.json',
  '/i18n/en/docusaurus-plugin-content-docs/version-13.6.json',
  '/i18n/en/docusaurus-plugin-content-docs/version-13.6/intro.md',
];

/** Paths on the current line. Each must be a Crowdin source. */
export const CURRENT_LINE_PROBES = [
  '/docs/intro.md',
  '/docs/guides/restore.mdx',
  '/i18n/en/code.json',
  '/i18n/en/docusaurus-plugin-content-docs/current.json',
  '/i18n/en/docusaurus-theme-classic/navbar.json',
];

const OLD_LINE =
  /^\/(?:versioned_docs|versioned_sidebars)\/|\/docusaurus-plugin-content-docs\/version-/;

/**
 * A Crowdin path, as Crowdin resolves it: relative to `base_path` whether or not it starts with `/`.
 */
export function rooted(pattern) {
  return pattern.startsWith('/') ? pattern : `/${pattern}`;
}

/** A Crowdin glob (`**`, `*`, `?`, `{a,b}`) as an anchored regular expression. */
export function globToRegExp(pattern) {
  const glob = rooted(pattern);
  let out = '';
  for (let i = 0; i < glob.length; i += 1) {
    const ch = glob[i];
    if (ch === '*' && glob[i + 1] === '*') {
      // `**/` matches zero or more directories.
      out += glob[i + 2] === '/' ? '(?:.*/)?' : '.*';
      i += glob[i + 2] === '/' ? 2 : 1;
    } else if (ch === '*') {
      out += '[^/]*';
    } else if (ch === '?') {
      out += '[^/]';
    } else if (ch === '{' && glob.indexOf('}', i) !== -1) {
      const end = glob.indexOf('}', i);
      out += `(?:${glob
        .slice(i + 1, end)
        .split(',')
        .map(escape)
        .join('|')})`;
      i = end;
    } else {
      out += escape(ch);
    }
  }
  return new RegExp(`^${out}$`);
}

function escape(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Whether Crowdin would upload `file` (a docs-root path starting with `/`) as a source. */
export function isSource(file, entries) {
  return entries.some(
    (entry) =>
      globToRegExp(entry.source).test(file) &&
      !(entry.ignore ?? []).some((pattern) => globToRegExp(pattern).test(file)),
  );
}

/** Problems with the configuration itself, independent of the tree. */
export function configProblems(config) {
  if (config === null || typeof config !== 'object' || Array.isArray(config)) {
    return ['crowdin.yml is not a mapping'];
  }
  const problems = [];
  if ('project_id' in config || 'api_token' in config) {
    problems.push('credentials are in crowdin.yml; use project_id_env and api_token_env');
  }
  if (!config.project_id_env || !config.api_token_env) {
    problems.push('project_id_env and api_token_env must name the environment variables');
  }
  if (!Array.isArray(config.files) || config.files.length === 0) {
    return [...problems, 'crowdin.yml has no files'];
  }
  for (const entry of config.files) {
    if (typeof entry.source !== 'string' || typeof entry.translation !== 'string') {
      problems.push('every file entry needs a source and a translation');
      continue;
    }
    if (!/%(?:two_letters_code|locale|android_code|osx_locale)%/.test(entry.translation)) {
      problems.push(`${entry.source}: translation ${entry.translation} is not per-locale`);
    }
    const docs = rooted(entry.source).startsWith('/docs/');
    if (docs && !entry.translation.includes('/current/')) {
      problems.push(`${entry.source}: docs must translate into current/ only (VER-2)`);
    }
    // Either keeps English out of the export; the CLI rejects both on one entry.
    const skips = [entry.skip_untranslated_strings, entry.skip_untranslated_files];
    if (skips.filter((v) => v === true).length !== 1) {
      problems.push(
        `${entry.source}: set exactly one of skip_untranslated_strings or skip_untranslated_files, ` +
          'or Crowdin exports English as a translation (A11Y-18)',
      );
    }
  }
  for (const probe of OLD_LINE_PROBES) {
    if (isSource(probe, config.files)) {
      problems.push(`${probe} would be uploaded: a released line must not be translatable (VER-2)`);
    }
  }
  for (const probe of CURRENT_LINE_PROBES) {
    if (!isSource(probe, config.files)) {
      problems.push(`${probe} would not be uploaded: the current line must be translatable`);
    }
  }
  return problems;
}

/** Every file in the tree Crowdin would upload, and the old-line ones among them. */
export async function sourcesInTree(root, entries) {
  const sources = [];
  for await (const full of walk(root, (dir) => SKIP_DIRS.has(path.basename(dir)))) {
    const file = `/${path.relative(root, full).split(path.sep).join('/')}`;
    if (isSource(file, entries)) {
      sources.push(file);
    }
  }
  return {sources: sources.sort(), oldLine: sources.filter((f) => OLD_LINE.test(f)).sort()};
}

/** @typedef {import('./lib/build-output.mjs').Reporter} Reporter */

/**
 * @param {{root?: string, out?: Reporter}} [options]
 * @returns {Promise<number>} 0 clean, 1 on a violation, 2 when crowdin.yml cannot be read.
 */
export async function main({root = ROOT, out = /** @type {Reporter} */ (console)} = {}) {
  let config;
  try {
    config = yaml.load(await readFile(path.join(root, CONFIG), 'utf8'));
  } catch (error) {
    out.error(
      `check:i18n - cannot read ${CONFIG}: ${error instanceof Error ? error.message : error}`,
    );
    return 2;
  }
  const problems = configProblems(config ?? {});
  if (problems.length === 0) {
    const {sources, oldLine} = await sourcesInTree(root, config.files);
    problems.push(
      ...oldLine.map((f) => `${f} would be uploaded: it is on a released line (VER-2)`),
    );
    if (problems.length === 0) {
      out.log(
        `check:i18n - clean. ${sources.length} current-line source file(s); no released line is translatable (VER-2).`,
      );
      return 0;
    }
  }
  out.error(`check:i18n - ${problems.length} violation(s):\n`);
  for (const p of problems) {
    out.error(`  ${p}`);
  }
  return 1;
}

if (process.argv[1] === import.meta.filename) {
  process.exitCode = await main();
}
