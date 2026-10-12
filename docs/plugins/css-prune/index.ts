import postcss from 'postcss';
import selectorParser from 'postcss-selector-parser';
import type {Compiler} from 'webpack';
import type {Plugin} from '@docusaurus/types';

/**
 * PERF-1 — the site stylesheet ships only rules the built site can match.
 *
 * Docusaurus bundles every stylesheet into one file: all of Infima, every theme component's CSS
 * module (including the ones B34 swizzled away) and every component the site might render. During
 * client asset optimization this pass removes, from the stylesheets under `assets/css/`:
 *
 *   - selectors naming a class that no built page or script mentions. A class counts as mentioned
 *     when it appears as a token in any HTML or JS file, or when a token ending in `-` or `_` is a
 *     prefix of it, which keeps names built by concatenation (`alert--${type}`). Classes inside
 *     `:not()`, `:is()` and `:where()` are not required, so a negated or optional class never
 *     drops a selector that matches without it;
 *   - selectors pinning an interaction state for the component inventory (`[data-dbs-demo]`),
 *     which exists on the development server only (B29) and never in a build.
 *
 * Pruning runs before webpack computes real content hashes, so a CSS change receives a new
 * asset URL and the HTML/runtime references remain consistent.
 * A rule left with no selectors goes, and so does an at-rule left empty. Nothing else changes:
 * the pass cannot rename, reorder or alter a declaration. The development server is untouched.
 */

const TOKEN = /[A-Za-z0-9_-]+/g;

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
  return (name) =>
    !/^[\w-]+$/.test(name) ||
    tokens.has(name) ||
    prefixes.some((prefix) => name.startsWith(prefix));
}

/** Whether a selector can match the built site. */
export function selectorKept(selector: string, used: (name: string) => boolean): boolean {
  let kept = true;
  try {
    selectorParser((root) => {
      root.walkAttributes((attribute) => {
        if (attribute.attribute === 'data-dbs-demo') kept = false;
      });
      root.walkClasses((className) => {
        let parent = className.parent;
        while (parent) {
          // Negation and selector alternatives cannot prove that a class is required.
          if (parent.type === 'pseudo' && [':not', ':is', ':where'].includes(parent.value)) return;
          parent = parent.parent;
        }
        if (!used(className.value)) kept = false;
      });
    }).processSync(selector);
  } catch {
    // Unrecognized syntax is not evidence that a selector is unused.
    return true;
  }
  return kept;
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

/** Canonical tokens stay complete. Only drop unused declarations from emitted CSS.
 * All CSS var() dependencies are retained, even in otherwise unused token declarations.
 * Runtime literals are retained; dynamic token-name construction disables this optimization. */
export function pruneUnusedTokens(css: string, runtimeTexts: readonly string[]): string {
  if (runtimeTexts.some((text) => /["'`]--dbs-["'`]/.test(text))) return css;
  const used = new Set([...css.matchAll(/var\(\s*(--dbs-[\w-]+)/g)].map((match) => match[1]));
  for (const text of runtimeTexts)
    for (const match of text.matchAll(/--dbs-[\w-]+/g)) used.add(match[0]);
  const root = postcss.parse(css);
  root.walkDecls((declaration) => {
    if (declaration.prop.startsWith('--dbs-') && !used.has(declaration.prop)) declaration.remove();
  });
  return root.toString();
}

/** Optimize emitted client CSS before webpack updates content hashes and asset references. */
export const cssPruneOptimization = {
  apply(compiler: Compiler): void {
    const {Compilation, sources} = compiler.webpack;
    compiler.hooks.thisCompilation.tap('dbsync-css-prune', (compilation) => {
      compilation.hooks.processAssets.tap(
        {name: 'dbsync-css-prune', stage: Compilation.PROCESS_ASSETS_STAGE_OPTIMIZE_SIZE + 1},
        () => {
          const assets = compilation.getAssets();
          const runtimeTexts = assets
            .filter(({name}) => /\.(html|js)$/.test(name))
            .map(({source}) => source.source().toString());
          const used = usedBy(
            contentTokens(
              assets
                .filter(({name}) => /\.(html|js)$/.test(name))
                .map(({source}) => source.source().toString()),
            ),
          );
          for (const {name, source} of assets) {
            if (!name.startsWith('assets/css/') || !name.endsWith('.css')) continue;
            const result = pruneCss(source.source().toString(), used);
            compilation.updateAsset(
              name,
              new sources.RawSource(pruneUnusedTokens(result.css, runtimeTexts)),
            );
          }
        },
      );
    });
  },
};

export default function cssPrunePlugin(): Plugin {
  return {
    name: 'dbsync-css-prune',
    configureWebpack(_config, isServer) {
      return isServer ? {} : {plugins: [cssPruneOptimization]};
    },
  };
}
