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
 * TOK-6           Control-boundary binding (B35): no `border.default`, `border.strong`,
 *                 `border.warm` or `border.warm-strong` token in a `border*` declaration on a
 *                 control. Decorative hairlines (navbar rules, dividers, static card surfaces,
 *                 static KeyCap text, empty-state wrappers, the inventory's own section rules)
 *                 are allowlisted by selector, with the reason written down — anything else is
 *                 the exact misuse the token ladder exists to prevent (FLOOR-3).
 * NAV-5           The active docs-sidebar label binds `accent.primary-text`: at least one
 *                 `.menu__link--active` rule must set exactly that colour, and no such rule may
 *                 set any other.
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

/** Border tokens that may never bound a control (TOK-6): hairlines only. */
export const NON_INTERACTIVE_BORDERS = [
  '--dbs-border-default',
  '--dbs-border-strong',
  '--dbs-border-warm',
  '--dbs-border-warm-strong',
];

/** The sidebar active label's one binding (NAV-5). */
export const SIDEBAR_ACTIVE_TOKEN = '--dbs-accent-primary-text';

/** A `border*` declaration that paints a boundary (`border-radius` sizes corners, not edges). */
function isBoundaryProperty(property) {
  return (
    property === 'border' ||
    (property.startsWith('border-') && !property.startsWith('border-radius'))
  );
}

/**
 * Comments blanked to spaces of the same shape, so offsets — and therefore line numbers —
 * survive while commented-out code never trips the gate.
 */
function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, ' '));
}

/**
 * The innermost rule selector a declaration at `index` sits under, normalised to one line.
 * At-rules between the rule and the declaration are looked through; the selector of a rule
 * nested in `@media` still reads as the rule's own selector.
 */
export function innermostSelector(css, index) {
  const open = css.lastIndexOf('{', index);
  if (open === -1) {
    return '';
  }
  const previousClose = css.lastIndexOf('}', open - 1);
  const parentOpen = css.lastIndexOf('{', open - 1);
  return css
    .slice(Math.max(previousClose, parentOpen) + 1, open)
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * Whether a `border*` declaration holding a non-interactive token is a decorative hairline
 * rather than a control boundary. Every entry names the reason; anything unlisted is the
 * misuse TOK-6 exists to prevent. `file` is the stylesheet path relative to the docs root.
 */
export function isDecorativeBorder(file, selector) {
  const sel = selector.trim();
  if (sel === '.card') {
    return 'static card default; [data-link] and .card.select outrank it for every interactive kind';
  }
  if (sel.includes("[data-status='empty']")) {
    return 'empty placeholder, never interactive';
  }
  if (sel === '.cap') {
    return 'KeyCap is static text, not a control';
  }
  if (sel === '.framed') {
    return 'empty-state wrapper, not a control';
  }
  if (/\.list(?![a-z-])/.test(sel) && !/\.tab(?![a-z-])/.test(sel)) {
    return 'tablist rule under the tabs, not a tab';
  }
  if (sel === '.navbar') {
    return 'navbar hairline, not a control';
  }
  if (/^\.drawer\b/.test(sel) && !sel.includes('Github') && !sel.includes('.link')) {
    return 'nav drawer container rule, not a control';
  }
  if (file.endsWith('src/inventory/styles.module.css') && sel === '.entry') {
    return "inventory's own section rule in the dev tool";
  }
  return null;
}

/**
 * TOK-6: every `border*` declaration holding a non-interactive token, unless its selector is
 * a documented decorative hairline. Returns `{line, rule, message}` without the file name.
 */
export function findBorderProblems(file, text) {
  const css = stripComments(text);
  const lineAt = lineIndex(css);
  const problems = [];
  const pattern = /([a-z-]+)\s*:\s*([^;{}]+)/g;
  for (const match of css.matchAll(pattern)) {
    const property = match[1].toLowerCase();
    const value = match[2];
    if (!isBoundaryProperty(property)) {
      continue;
    }
    const token = NON_INTERACTIVE_BORDERS.find((name) => value.includes(name));
    if (!token) {
      continue;
    }
    const selector = innermostSelector(css, match.index);
    const reason = isDecorativeBorder(file, selector);
    if (reason !== null) {
      continue;
    }
    problems.push({
      line: lineAt(match.index),
      rule: 'TOK-6',
      message:
        `${token} bounds '${selector || '<unknown>'}' - controls bind border.interactive ` +
        `(${reason === null ? 'no decorative reason applies' : reason})`,
    });
  }
  return problems;
}

/**
 * NAV-5: `.menu__link--active` rules in one stylesheet that set a colour other than the
 * sidebar binding. The missing-binding case is tree-wide and reported by `main`.
 */
export function findNavProblems(file, text) {
  const css = stripComments(text);
  const lineAt = lineIndex(css);
  const problems = [];
  const blocks = css.split('}');
  for (const block of blocks) {
    const brace = block.indexOf('{');
    if (brace === -1 || !block.slice(0, brace).includes('menu__link--active')) {
      continue;
    }
    const offset = css.indexOf(block);
    for (const decl of block.slice(brace + 1).split(';')) {
      const colon = decl.indexOf(':');
      if (colon === -1) {
        continue;
      }
      if (decl.slice(0, colon).trim().toLowerCase() !== 'color') {
        continue;
      }
      const value = decl.slice(colon + 1).trim();
      if (value !== `var(${SIDEBAR_ACTIVE_TOKEN})`) {
        problems.push({
          line: lineAt(offset + brace),
          rule: 'NAV-5',
          message: `active sidebar label sets ${value} - bind ${`var(${SIDEBAR_ACTIVE_TOKEN})`}`,
        });
      }
    }
  }
  return problems;
}

/** Tree-wide NAV-5: at least one stylesheet must carry the sidebar active binding. */
export function hasSidebarBinding(cssTexts) {
  return cssTexts.some((text) =>
    stripComments(text)
      .split('}')
      .some((block) => {
        const brace = block.indexOf('{');
        if (brace === -1 || !block.slice(0, brace).includes('menu__link--active')) {
          return false;
        }
        return block
          .slice(brace + 1)
          .split(';')
          .some((decl) => {
            const colon = decl.indexOf(':');
            return (
              colon !== -1 &&
              decl.slice(0, colon).trim().toLowerCase() === 'color' &&
              decl.slice(colon + 1).trim() === `var(${SIDEBAR_ACTIVE_TOKEN})`
            );
          });
      }),
  );
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
    const text = await readFile(full, 'utf8');
    for (const v of findCodeProblems(file, text)) {
      violations.push({file, ...v});
    }
    if ((file.endsWith('.css') || file.endsWith('.scss')) && file !== TOKENS_CSS) {
      for (const v of findBorderProblems(file, text)) {
        violations.push({file, ...v});
      }
      for (const v of findNavProblems(file, text)) {
        violations.push({file, ...v});
      }
    }
  }
  return violations;
}

/** Tree-wide NAV-5 over a docs root: any stylesheet carrying the sidebar active binding. */
async function hasSidebarBindingIn(root) {
  const texts = [];
  const skip = (dir) =>
    SKIP_DIRS.has(path.basename(dir)) ||
    (path.dirname(dir) === root && ['test', 'design'].includes(path.basename(dir)));
  for await (const full of walk(root, skip)) {
    const file = path.relative(root, full).split(path.sep).join('/');
    if (file.startsWith('scripts/') || file === TOKENS_CSS) {
      continue;
    }
    if (path.extname(full) === '.css' || path.extname(full) === '.scss') {
      texts.push(await readFile(full, 'utf8'));
    }
  }
  return hasSidebarBinding(texts);
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
  const sidebar = (await hasSidebarBindingIn(root))
    ? []
    : [
        {
          where: '(stylesheets)',
          what: 'menu__link--active',
          rule: 'NAV-5',
          message: `no active sidebar binding - set color: var(${SIDEBAR_ACTIVE_TOKEN})`,
        },
      ];

  if (overrides.length === 0 && code.length === 0 && sidebar.length === 0) {
    out.log('check:token-lint - clean. THM-4, TOK-1, TOK-6, TOK-10, TOK-12 and NAV-5 hold.');
    return 0;
  }
  out.error(
    `check:token-lint - ${overrides.length + code.length + sidebar.length} violation(s):\n`,
  );
  for (const p of overrides) {
    out.error(`  ${SOURCE}  ${p.set}.${p.name}  ${p.rule}  ${p.message}`);
  }
  for (const v of code) {
    out.error(`  ${v.file}:${v.line}  ${v.rule}  ${v.message}`);
  }
  for (const s of sidebar) {
    out.error(`  ${s.where}  ${s.what}  ${s.rule}  ${s.message}`);
  }
  return 1;
}

if (process.argv[1] === import.meta.filename) {
  process.exitCode = await main();
}
