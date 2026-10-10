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
 *
 * Run by `npm run check:css` and by CI. Scans stylesheets and the style blocks of source files.
 */
import {readFile, readdir} from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const ROOT = path.resolve(import.meta.dirname, '..');

/** Directories never scanned. */
const SKIP_DIRS = new Set(['node_modules', 'build', '.docusaurus', 'coverage', '.git', 'test']);

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

/** Line number (1-based) of a character offset. */
function lineAt(css, offset) {
  let line = 1;
  for (let i = 0; i < offset; i += 1) {
    if (css[i] === '\n') {
      line += 1;
    }
  }
  return line;
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

function transitionNamesLayout(value) {
  return value.split(',').some((part) => LAYOUT_IN_LIST.test(part.trim().split(/\s+/)[0] ?? ''));
}

/** Check one stylesheet's text. Returns violations without a file name. */
export function checkCss(source) {
  const css = stripComments(source);
  const violations = [];
  const push = (decl, rule, message) =>
    violations.push({
      line: lineAt(css, decl.offset),
      rule,
      message,
      text: `${decl.property}: ${decl.value}`,
    });

  for (const decl of declarations(css)) {
    const {property, value, selectors} = decl;
    const inKeyframes = selectors.some((s) => /^@(-\w+-)?keyframes\b/.test(s));

    if (property === 'outline' && /^(none|0)\b/.test(value)) {
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

    if (property === 'will-change' && value !== 'auto') {
      const rule = selectors[selectors.length - 1] ?? '';
      if (!INTERACTION_STATE.test(rule)) {
        push(decl, 'PERF-5', 'resting will-change - set it only in an interaction state');
      }
    }
  }

  return violations;
}

async function* walk(dir) {
  const entries = await readdir(dir, {withFileTypes: true});
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) {
        yield* walk(full);
      }
    } else if (entry.isFile()) {
      yield full;
    }
  }
}

export async function findViolations(root = ROOT) {
  const violations = [];
  for await (const full of walk(root)) {
    if (!SCAN_EXTENSIONS.has(path.extname(full))) {
      continue;
    }
    const file = path.relative(root, full).split(path.sep).join('/');
    for (const v of checkCss(await readFile(full, 'utf8'))) {
      violations.push({file, ...v});
    }
  }
  return violations;
}

/**
 * @typedef {{log: (message: string) => void, error: (message: string) => void}} Reporter
 */

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
    out.log('check:css - clean. FLOOR-4, PERF-3 and PERF-5 hold.');
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
