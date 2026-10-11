#!/usr/bin/env node
/**
 * Style gates — three grep-style rules that encode accessibility and performance floors in CI.
 *
 * FLOOR-4  `outline: none` (or `outline: 0`) removes the focus indicator. Restyle focus, never
 *          remove it.
 * PERF-3   Animating a layout property (width, height, top, margin, …) forces layout on every
 *          frame. Animate `transform` and `opacity` instead.
 * PERF-5   A resting `will-change` keeps a compositor layer alive for the element's whole life.
 *          Set it only in an interaction state (`:hover`, `:focus-*`, `:active`) or not at all.
 * DF-1     No type size outside the 13-style scale. `font-size` must be a
 *          `var(--dbs-font-<style>-size)` token and the `font` shorthand a `var(--dbs-font-<style>)`
 *          token, where <style> is one of the styles in `design/tokens.source.json`.
 *
 * Run by `npm run check:css` and by CI. Scans every `.css` and `.scss` file outside build output,
 * dependencies and the top-level `test/` directory (whose fixtures break the rules on purpose).
 */
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import {lineIndex, walk} from './lib/build-output.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');

/** The token source that names the 13 type styles (DF-1), relative to the scanned root. */
export const TOKEN_SOURCE = 'design/tokens.source.json';

/** Directories never scanned, wherever they sit. */
const SKIP_DIRS = new Set(['node_modules', 'build', '.docusaurus', 'coverage', '.git']);

/** Directories skipped only at the scan root: `test/` holds fixtures that break the rules. */
const SKIP_ROOT_DIRS = new Set(['test']);

/** Files that hold CSS. */
const SCAN_EXTENSIONS = new Set(['.css', '.scss']);

/** Properties whose animation triggers layout (PERF-3). */
const LAYOUT_PROPERTIES = [
  'width',
  'height',
  'min-width',
  'min-height',
  'max-width',
  'max-height',
  'top',
  'right',
  'bottom',
  'left',
  'inset',
  'margin',
  'margin-top',
  'margin-right',
  'margin-bottom',
  'margin-left',
  'padding',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'border-width',
  'font-size',
  'line-height',
];

/** Selector states in which `will-change` is allowed (PERF-5). */
const INTERACTION_STATE = /:(hover|focus|focus-visible|focus-within|active)\b/;

const LAYOUT_ALTERNATION = LAYOUT_PROPERTIES.join('|');
const LAYOUT_IN_LIST = new RegExp(`(^|[\\s,])(${LAYOUT_ALTERNATION}|all)(?=[\\s,]|$)`);
const LAYOUT_DECLARATION = new RegExp(`^(${LAYOUT_ALTERNATION})$`);

/**
 * Replace every comment with spaces of the same shape, so line numbers survive and commented-out
 * code never trips a gate.
 */
function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, ' '));
}

/**
 * Walk the stylesheet as nested blocks and yield each declaration with the selector chain it sits
 * under. This is a tolerant scanner, not a parser: it understands braces, `;` and `:`, which is
 * all three gates need.
 */
function* declarations(css) {
  const stack = [];
  let start = 0;

  for (let i = 0; i < css.length; i += 1) {
    const ch = css[i];
    if (ch === '{') {
      stack.push(css.slice(start, i).trim());
      start = i + 1;
    } else if (ch === '}' || ch === ';') {
      const text = css.slice(start, i);
      const colon = text.indexOf(':');
      if (colon !== -1) {
        const offset = start + (text.length - text.trimStart().length);
        yield {
          property: text.slice(0, colon).trim().toLowerCase(),
          value: text.slice(colon + 1).trim(),
          selectors: [...stack],
          offset,
        };
      }
      if (ch === '}') {
        stack.pop();
      }
      start = i + 1;
    }
  }
}

/**
 * True when every selector in the innermost style rule is in an interaction state. At-rules
 * (`@media`, `@supports`) nested inside the rule are looked through, and a selector list only
 * passes when each of its selectors carries the state: `.a, .b:hover` leaves `.a` at rest.
 */
function inInteractionState(selectors) {
  const rule = [...selectors].reverse().find((s) => !s.startsWith('@')) ?? '';
  const parts = rule.split(',').map((s) => s.trim());
  return parts.length > 0 && parts.every((s) => INTERACTION_STATE.test(s));
}

/** Outline declarations that remove the focus indicator (FLOOR-4). */
function removesOutline(property, value) {
  const zero = /^0(px|em|rem)?(\s|!|$)/;
  const none = /^none(\s|!|$)/;
  return (
    (property === 'outline' && (none.test(value) || zero.test(value))) ||
    (property === 'outline-style' && none.test(value)) ||
    (property === 'outline-width' && zero.test(value))
  );
}

/** Values that defer to the cascade rather than set a size, so they never break the scale. */
const CASCADE_KEYWORD = /^(inherit|initial|unset|revert|revert-layer)$/;

/**
 * The style a `var(--dbs-font-<style><suffix>)` value names, or null when the value is anything
 * else. `styles` (when given) limits the names to the real scale.
 */
function typeToken(value, suffix, styles) {
  const match = new RegExp(`^var\\(--dbs-font-([a-z0-9-]+)${suffix}\\)$`).exec(value);
  const name = match?.[1];
  return name && (!styles || styles.has(name)) ? name : null;
}

/**
 * The style names in the token source's typography group (DF-1). A missing source is an error, not
 * a pass: without the scale every `--dbs-font-*` name, family tokens included, would satisfy DF-1.
 */
export async function loadTypeStyles(root = ROOT) {
  let raw;
  try {
    raw = await readFile(path.join(root, TOKEN_SOURCE), 'utf8');
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code === 'ENOENT') {
      throw new Error(`${TOKEN_SOURCE} not found - DF-1 cannot check the type scale without it`);
    }
    throw error;
  }
  const style = JSON.parse(raw).base?.typography?.style;
  if (!style || Object.keys(style).length === 0) {
    throw new Error(`${TOKEN_SOURCE} has no base.typography.style group`);
  }
  return new Set(Object.keys(style));
}

function transitionNamesLayout(value) {
  return value.split(',').some((part) => LAYOUT_IN_LIST.test(part.trim().split(/\s+/)[0] ?? ''));
}

/**
 * Check one stylesheet's text. Returns violations without a file name. `typeStyles` is the set of
 * type style names (DF-1); without it any `--dbs-font-*` token passes the type-scale rule, so the
 * tree scan always passes it.
 *
 * @param {string} source
 * @param {Set<string>} [typeStyles]
 */
export function checkCss(source, typeStyles) {
  const css = stripComments(source);
  const lineAt = lineIndex(css);
  const violations = [];
  const push = (decl, rule, message) =>
    violations.push({
      line: lineAt(decl.offset),
      rule,
      message,
      text: `${decl.property}: ${decl.value}`,
    });

  for (const decl of declarations(css)) {
    const {value, selectors} = decl;
    // Vendor prefixes (-webkit-transition) obey the same rules as the standard property.
    const property = decl.property.replace(/^-[a-z]+-/, '');
    const inKeyframes = selectors.some((s) => /^@(-\w+-)?keyframes\b/.test(s));

    if (removesOutline(property, value)) {
      push(decl, 'FLOOR-4', 'outline removed - restyle focus instead of removing it');
    }

    if (
      (property === 'transition' || property === 'transition-property') &&
      transitionNamesLayout(value)
    ) {
      push(decl, 'PERF-3', 'layout property animated - transition transform/opacity instead');
    }

    if (inKeyframes && LAYOUT_DECLARATION.test(property)) {
      push(decl, 'PERF-3', 'layout property in @keyframes - animate transform/opacity instead');
    }

    const plain = value.replace(/\s*!important$/i, '');
    if (
      property === 'font-size' &&
      !CASCADE_KEYWORD.test(plain) &&
      !typeToken(plain, '-size', typeStyles)
    ) {
      push(decl, 'DF-1', 'type size outside the scale - use var(--dbs-font-<style>-size)');
    }

    if (property === 'font' && !CASCADE_KEYWORD.test(plain) && !typeToken(plain, '', typeStyles)) {
      push(decl, 'DF-1', 'font shorthand outside the scale - use var(--dbs-font-<style>)');
    }

    if (property === 'will-change' && value !== 'auto') {
      if (!inInteractionState(selectors)) {
        push(decl, 'PERF-5', 'resting will-change - set it only in an interaction state');
      }
    }
  }

  return violations;
}

export async function findViolations(root = ROOT) {
  root = path.resolve(root);
  const typeStyles = await loadTypeStyles(root);
  const violations = [];
  const skip = (dir) =>
    SKIP_DIRS.has(path.basename(dir)) ||
    (path.dirname(dir) === root && SKIP_ROOT_DIRS.has(path.basename(dir)));
  for await (const full of walk(root, skip)) {
    if (!SCAN_EXTENSIONS.has(path.extname(full))) {
      continue;
    }
    const file = path.relative(root, full).split(path.sep).join('/');
    for (const v of checkCss(await readFile(full, 'utf8'), typeStyles)) {
      violations.push({file, ...v});
    }
  }
  return violations;
}

/** @typedef {import('./lib/build-output.mjs').Reporter} Reporter */

/**
 * Run the gates and report. Returns the process exit code: 0 clean, 1 on any violation.
 *
 * @param {string} [root] Directory to scan. Defaults to the docs root.
 * @param {Reporter} [out] Where the report goes.
 * @returns {Promise<number>}
 */
export async function main(root = ROOT, out = /** @type {Reporter} */ (console)) {
  const violations = await findViolations(root);

  if (violations.length === 0) {
    out.log('check:css - clean. FLOOR-4, PERF-3, PERF-5 and DF-1 hold.');
    return 0;
  }

  out.error(`check:css - ${violations.length} violation(s):\n`);
  for (const v of violations) {
    out.error(`  ${v.file}:${v.line}  ${v.rule}  ${v.message}`);
    out.error(`    ${v.text}`);
  }
  return 1;
}

if (process.argv[1] === import.meta.filename) {
  process.exitCode = await main();
}
