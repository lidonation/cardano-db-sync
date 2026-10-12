import fs from 'node:fs/promises';
import path from 'node:path';

import postcss from 'postcss';
import type {Plugin} from '@docusaurus/types';

/**
 * PERF-1 — the site stylesheet ships only rules the built site can match.
 *
 * Docusaurus bundles every stylesheet into one file: all of Infima, every theme component's CSS
 * module (including the ones B34 swizzled away) and every component the site might render. After
 * each build this pass removes, from the stylesheets under `assets/css/`:
 *
 *   - selectors naming a class that no built page or script mentions. A class counts as mentioned
 *     when it appears as a token in any HTML or JS file, or when a token ending in `-` or `_` is a
 *     prefix of it, which keeps names built by concatenation (`alert--${type}`). Classes inside
 *     `:not()`, `:is()` and `:where()` are not required, so a negated or optional class never
 *     drops a selector that matches without it;
 *   - selectors pinning an interaction state for the component inventory (`[data-dbs-demo]`),
 *     which exists on the development server only (B29) and never in a build.
 *
 * A rule left with no selectors goes, and so does an at-rule left empty. Nothing else changes:
 * the pass cannot rename, reorder or alter a declaration. The development server is untouched.
 */

const TOKEN = /[A-Za-z0-9_-]+/g;
const CLASS = /\.(-?[_a-zA-Z][\w-]*)/g;
const OPTIONAL = /:(?:not|is|where)\((?:[^()]|\([^()]*\))*\)/g;
const DEMO = /\[data-dbs-demo/;

/** The tokens a built page or script could use as class names. */
export function contentTokens(texts: Iterable<string>): Set<string> {
  const tokens = new Set<string>();
  for (const text of texts) {
    for (const token of text.match(TOKEN) ?? []) tokens.add(token);
  }
  return tokens;
}

/** Whether a class is mentioned by the content, directly or by a concatenation prefix. */
export function usedBy(tokens: ReadonlySet<string>): (name: string) => boolean {
  const prefixes = [...tokens].filter((token) => token.length > 2 && /[-_]$/.test(token));
  return (name) => tokens.has(name) || prefixes.some((prefix) => name.startsWith(prefix));
}

/** Whether a selector can match the built site. */
export function selectorKept(selector: string, used: (name: string) => boolean): boolean {
  if (DEMO.test(selector)) return false;
  const required = selector.replace(OPTIONAL, '');
  return [...required.matchAll(CLASS)].every((match) => used(match[1]));
}

/** The stylesheet with every unmatched selector, rule and empty at-rule removed. */
export function pruneCss(
  css: string,
  used: (name: string) => boolean,
): {css: string; removed: number} {
  const root = postcss.parse(css);
  let removed = 0;
  root.walkRules((rule) => {
    if (
      rule.parent?.type === 'atrule' &&
      /keyframes$/i.test((rule.parent as postcss.AtRule).name)
    ) {
      return;
    }
    const kept = rule.selectors.filter((selector) => selectorKept(selector, used));
    removed += rule.selectors.length - kept.length;
    if (kept.length === 0) {
      rule.remove();
    } else if (kept.length < rule.selectors.length) {
      rule.selectors = kept;
    }
  });
  root.walkAtRules((atRule) => {
    if (atRule.nodes !== undefined && atRule.nodes.length === 0) atRule.remove();
  });
  return {css: root.toString(), removed};
}

async function files(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, {withFileTypes: true, recursive: true});
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(entry.parentPath, entry.name));
}

/** Prune every stylesheet under `outDir/assets/css` against the HTML and JS under `outDir`. */
export async function pruneBuild(outDir: string): Promise<number> {
  const all = await files(outDir);
  const content = await Promise.all(
    all.filter((file) => /\.(html|js)$/.test(file)).map((file) => fs.readFile(file, 'utf8')),
  );
  const used = usedBy(contentTokens(content));
  const cssDir = path.join(outDir, 'assets', 'css');
  let removed = 0;
  for (const file of all.filter((file) => path.dirname(file) === cssDir && file.endsWith('.css'))) {
    const result = pruneCss(await fs.readFile(file, 'utf8'), used);
    removed += result.removed;
    await fs.writeFile(file, result.css, 'utf8');
  }
  return removed;
}

export default function cssPrunePlugin(): Plugin {
  return {
    name: 'dbsync-css-prune',
    async postBuild({outDir}) {
      await pruneBuild(outDir);
    },
  };
}
