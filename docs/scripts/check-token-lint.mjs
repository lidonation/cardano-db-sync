#!/usr/bin/env node
/**
 * Token lint — the token rules that are not per-declaration CSS (B03).
 *
 * TOK-12         No theme override that changes nothing: a theme set entry equal to its base value
 *                 (compared case-blind) is a no-op.
 * THM-4           No theme override of a name the base set does not define: a theme-less build
 *                 would miss it. Both are read from `design/tokens.source.json`.
 * TOK-1 / TOK-13  No colour literal in component code (`.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.mdx`
 *                 outside `scripts/`): a string that is a hex colour, or a string holding a 6/8-digit
 *                 hex or a colour function. An `href`/`to` fragment (`"#add"`) is a link, not a
 *                 colour. Stylesheets are covered by `check:css`.
 * TOK-10          No reference to the retired `*-inverse` family anywhere in the site source:
 *                 nothing that needs "the dark value" may get it from a base token.
 *
 * Run by `npm run check:token-lint` and by CI.
 */
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import {SKIP_DIRS, TOKENS_CSS, lineIndex, walk} from './lib/build-output.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
export const SOURCE = 'design/tokens.source.json';
export {TOKENS_CSS};

/** The `*-inverse` family (TOK-10) as named in the token source; `varName` gives the CSS name. */
export const RETIRED_TOKENS = [
  'surface.inverse-selected',
  'surface.inverse-tip',
  'surface.navy-raised',
  'border.inverse',
  'accent.primary-inverse',
  'accent.primary-inverse-hover',
  'accent.secondary-inverse',
];

const CODE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.mdx']);
const SOURCE_EXTENSIONS = new Set([...CODE_EXTENSIONS, '.css', '.scss', '.md']);

/** A one-line string literal and its body. */
const STRING_LITERAL = /(['"`])((?:\\.|(?!\1)[^\\\n])*)\1/g;

/** A string body that is exactly a hex colour. */
const HEX_COLOUR = /^#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})$/i;

/** A colour inside a longer string: a 6/8-digit hex (not a URL fragment) or a colour function. */
const COLOUR_IN_STRING =
  /(?<![\w/&#-])#(?:[0-9a-f]{8}|[0-9a-f]{6})(?![\w-])|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/i;

/** A fragment link: the string is the value of an `href` or `to` attribute. */
const LINK_ATTRIBUTE = /\b(?:href|to|xlinkHref)\s*=\s*\{?\s*$/;

/** The colour literals in one file's code, as `{index, text}`. */
function colourLiterals(text) {
  const found = [];
  for (const match of text.matchAll(STRING_LITERAL)) {
    const body = match[2];
    const exact = HEX_COLOUR.test(body);
    if (exact && LINK_ATTRIBUTE.test(text.slice(Math.max(0, match.index - 40), match.index))) {
      continue;
    }
    if (exact || COLOUR_IN_STRING.test(body)) {
      found.push({index: match.index, text: match[0]});
    }
  }
  return found;
}

/** `surface.inverse-tip` → `--dbs-surface-inverse-tip` (the generator's naming). */
export const varName = (dotted) =>
  `--dbs-${dotted
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')}`;

/** Leaf tokens of a set as `dotted.name → value`, skipping `_`/`$` keys and the type scale. */
export function flatten(node, prefix = []) {
  const out = new Map();
  for (const [key, value] of Object.entries(node ?? {})) {
    if (
      key.startsWith('_') ||
      key.startsWith('$') ||
      (prefix.length === 0 && key === 'typography')
    ) {
      continue;
    }
    if (value && typeof value === 'object' && !('$value' in value) && !('value' in value)) {
      for (const [k, v] of flatten(value, [...prefix, key])) out.set(k, v);
    } else {
      out.set([...prefix, key].join('.'), value?.$value ?? value?.value ?? value);
    }
  }
  return out;
}

/** Token values compared as the browser reads them: `#FFFFFF` and `#ffffff` are one colour. */
const sameValue = (a, b) =>
  typeof a === 'string' && typeof b === 'string'
    ? a.trim().toLowerCase() === b.trim().toLowerCase()
    : JSON.stringify(a) === JSON.stringify(b);

/** THM-4 / TOK-12: theme overrides that change nothing, or name nothing in base. */
export function findOverrideProblems(source) {
  const base = flatten(source.base);
  const problems = [];
  for (const [set, tree] of Object.entries(source)) {
    if (set === 'base' || set.startsWith('_') || set.startsWith('$')) {
      continue;
    }
    for (const [name, value] of flatten(tree)) {
      if (!base.has(name)) {
        problems.push({
          set,
          name,
          rule: 'THM-4',
          message: 'overrides a name the base set does not define',
        });
      } else if (sameValue(base.get(name), value)) {
        problems.push({
          set,
          name,
          rule: 'TOK-12',
          message: `no-op override: same value as base (${value})`,
        });
      }
    }
  }
  return problems;
}

/**
 * Hex colour literals and retired-token references in one source file. In the generated
 * tokens.css the retired tokens are still defined, so only `var(...)` uses count there.
 */
export function findCodeProblems(file, text) {
  const generated = file === TOKENS_CSS;
  const lineAt = lineIndex(text);
  const problems = [];
  if (!generated && CODE_EXTENSIONS.has(path.extname(file))) {
    for (const literal of colourLiterals(text)) {
      problems.push({
        line: lineAt(literal.index),
        rule: 'TOK-1',
        message: `colour literal ${literal.text} - use a --dbs-* token`,
      });
    }
  }
  for (const dotted of RETIRED_TOKENS) {
    const name = generated ? `var\\(${varName(dotted)}` : varName(dotted);
    const pattern = new RegExp(`${name}(?![a-z0-9-])`, 'g');
    for (const match of text.matchAll(pattern)) {
      problems.push({
        line: lineAt(match.index),
        rule: 'TOK-10',
        message: `retired token ${varName(dotted)} (${dotted}) - use the themed role instead`,
      });
    }
  }
  return problems;
}

/** Every source file under the docs root except dependencies, build output, tests and tokens.css. */
export async function findViolations(root = ROOT) {
  root = path.resolve(root);
  const violations = [];
  const skip = (dir) =>
    SKIP_DIRS.has(path.basename(dir)) ||
    (path.dirname(dir) === root && ['test', 'design'].includes(path.basename(dir)));
  for await (const full of walk(root, skip)) {
    const file = path.relative(root, full).split(path.sep).join('/');
    if (!SOURCE_EXTENSIONS.has(path.extname(full)) || file.startsWith('scripts/')) {
      continue;
    }
    for (const v of findCodeProblems(file, await readFile(full, 'utf8'))) {
      violations.push({file, ...v});
    }
  }
  return violations;
}

/** @typedef {import('./lib/build-output.mjs').Reporter} Reporter */

/**
 * Run the lint and report. Returns the process exit code: 0 clean, 1 on any violation, 2 when the
 * token source cannot be read.
 *
 * @param {{root?: string, out?: Reporter}} [options]
 * @returns {Promise<number>}
 */
export async function main({root = ROOT, out = /** @type {Reporter} */ (console)} = {}) {
  let source;
  try {
    source = JSON.parse(await readFile(path.join(root, SOURCE), 'utf8'));
  } catch (error) {
    out.error(
      `check:token-lint - cannot read ${SOURCE}: ${error instanceof Error ? error.message : error}`,
    );
    return 2;
  }
  const overrides = findOverrideProblems(source);
  const code = await findViolations(root);

  if (overrides.length === 0 && code.length === 0) {
    out.log('check:token-lint - clean. THM-4, TOK-1, TOK-10 and TOK-12 hold.');
    return 0;
  }
  out.error(`check:token-lint - ${overrides.length + code.length} violation(s):\n`);
  for (const p of overrides) {
    out.error(`  ${SOURCE}  ${p.set}.${p.name}  ${p.rule}  ${p.message}`);
  }
  for (const v of code) {
    out.error(`  ${v.file}:${v.line}  ${v.rule}  ${v.message}`);
  }
  return 1;
}

if (process.argv[1] === import.meta.filename) {
  process.exitCode = await main();
}
