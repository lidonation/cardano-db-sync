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
 *          token, where <style> is one of the styles in `design/tokens.source.json`. A rule that
 *          sets the shorthand must also set `letter-spacing: var(--dbs-font-<style>-tracking)`,
 *          because the shorthand cannot carry tracking; the generated `.dbs-type-<style>` classes
 *          do both.
 * TOK-5    Only text-role tokens in a text-colour position (`color`, `-webkit-text-fill-color`,
 *          `caret-color`, `text-decoration-color`, `text-emphasis-color`): `--dbs-text-*`,
 *          `--dbs-code-text*` or `--dbs-*-text`. A fill or border token there is a contrast bug
 *          waiting for a theme; `brand.*` is named separately (TOK-4). The colour inside a
 *          `text-decoration` or `text-emphasis` shorthand is held to the same rule.
 * TOK-1    No raw colour (hex, a colour function or a named colour) in any stylesheet but the generated
 *          `src/css/tokens.css`, custom properties included: there is no second palette.
 * FLOOR-8  No side border (`border-left`/`-right`/`-inline`/`-inline-start`/`-inline-end`, or a
 *          `border-width` whose sides outweigh top and bottom) wider than 1px, and no gradient text
 *          (`background-clip: text`).
 *
 * Run by `npm run check:css` and by CI. Scans every `.css` and `.scss` file outside build output,
 * dependencies and the top-level `test/` directory (whose fixtures break the rules on purpose).
 */
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import {SKIP_DIRS, TOKENS_CSS, lineIndex, walk} from './lib/build-output.mjs';
import {declarations, stripComments} from './lib/css-declarations.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');

/** The token source that names the 13 type styles (DF-1), relative to the scanned root. */
export const TOKEN_SOURCE = 'design/tokens.source.json';

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

/** The generated token stylesheet: the one place colours are defined (TOK-1). */
export {TOKENS_CSS};

/** A raw colour: a hex literal or a colour function. Strings and `url()` are blanked first. */
const RAW_COLOUR =
  /#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/i;

/** The CSS named colours, less `transparent` and `currentColor`, which pick no palette colour. */
const NAMED_COLOURS = (
  'aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue ' +
  'blueviolet brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk ' +
  'crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki ' +
  'darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen ' +
  'darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue ' +
  'dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite ' +
  'gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki ' +
  'lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan ' +
  'lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen ' +
  'lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen ' +
  'magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen ' +
  'mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream ' +
  'mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid ' +
  'palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum ' +
  'powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown ' +
  'seagreen seashell sienna silver skyblue slateblue slategray slategrey snow springgreen ' +
  'steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen'
).split(' ');
const NAMED_COLOUR = new RegExp(`(?<![\\w-])(?:${NAMED_COLOURS.join('|')})(?![\\w-])`, 'i');

/** Properties that can take a colour, so a bare word there is a named colour, not a name. */
const COLOUR_PROPERTY =
  /^--|color|background|border|outline|shadow|^fill$|^stroke$|text-decoration|text-emphasis|column-rule|scrollbar/;

/** The value with quoted strings and `url()` blanked, so `url("#id")` and `content` never match. */
function withoutStrings(value) {
  return value.replace(/url\([^)]*\)/gi, ' ').replace(/(["'])(?:\\.|(?!\1)[^\\])*\1/g, ' ');
}

/** Text-colour positions (TOK-5). */
const TEXT_COLOUR_PROPERTIES = new Set([
  'color',
  'text-fill-color',
  'caret-color',
  'text-decoration-color',
  'text-emphasis-color',
]);

/** Shorthands that carry a text colour among other parts (TOK-5). */
const TEXT_COLOUR_SHORTHANDS = new Set(['text-decoration', 'text-emphasis']);

/** Text-colour values that pick no palette colour of their own. */
const TEXT_COLOUR_KEYWORD = /^(inherit|initial|unset|revert|revert-layer|currentcolor)$/i;

/** A token a text-colour position may use: text.*, code.text* or *-text (TOK-5). */
const TEXT_ROLE_TOKEN = /^var\(--dbs-(text-[a-z0-9-]+|code-text[a-z0-9-]*|[a-z0-9-]+-text)\)$/;

/** A length token: the `space` and `radius` groups (TOK-3). */
const LENGTH_TOKEN = /^var\(--dbs-(space|radius)-([a-z0-9-]+)\)$/;

/**
 * The problem with a text-colour value, or null when it is a text-role token or a keyword.
 *
 * @param {string} value
 */
function textColourProblem(value) {
  if (TEXT_COLOUR_KEYWORD.test(value) || TEXT_ROLE_TOKEN.test(value)) {
    return null;
  }
  if (/^var\(--dbs-brand-/.test(value)) {
    return ['TOK-4', 'brand token in a text position - use a text.* role'];
  }
  return [
    'TOK-5',
    'text colour is not a text-role token - use --dbs-text-*, --dbs-code-text* or *-text',
  ];
}

/**
 * The colour parts of a `text-decoration` / `text-emphasis` shorthand: every `var()` that is not a
 * length token, and any raw colour (which TOK-1 reports as well).
 *
 * @param {string} value
 */
function shorthandColours(value) {
  const vars = [...value.matchAll(/var\([^)]*\)/g)].map((m) => m[0]);
  return vars.filter((v) => !LENGTH_TOKEN.test(v) && !/^var\(--dbs-font-/.test(v));
}

/** Side-border properties (FLOOR-8): one side, or both inline sides at once. */
const SIDE_BORDER = /^border-(left|right|inline|inline-start|inline-end)(-width)?$/;
const KEYWORD_WIDTH = {thin: 1, medium: 3, thick: 5};

/**
 * The width one value part sets, in px (rem/em at 16px), or 0 when it sets none. A `space` token
 * is its own name in px; a `radius` token is never a hairline, so it counts as 2px.
 *
 * @param {string} part
 */
function partWidthPx(part) {
  const keyword = KEYWORD_WIDTH[part.toLowerCase()];
  if (keyword) {
    return keyword;
  }
  const length = /^(\d*\.?\d+)(px|r?em)$/i.exec(part);
  if (length) {
    return Number(length[1]) * (length[2].toLowerCase() === 'px' ? 1 : 16);
  }
  const token = LENGTH_TOKEN.exec(part);
  if (token) {
    return token[1] === 'space' && /^\d+$/.test(token[2]) ? Number(token[2]) : 2;
  }
  return 0;
}

/** The value split into parts, keeping each `var(...)` whole. */
const valueParts = (value) => value.match(/var\([^)]*\)|[^\s]+/g) ?? [];

/**
 * The widest width a side-border value sets, in px, or 0 when it sets none.
 *
 * @param {string} value
 */
function borderWidthPx(value) {
  return Math.max(0, ...valueParts(value).map(partWidthPx));
}

/**
 * True when a `border-width` shorthand makes a side accent: a left or right side wider than 1px
 * and wider than the top and bottom. A uniform 2px border is a full border, not a side accent.
 *
 * @param {string} value
 */
function borderWidthIsSideAccent(value) {
  const widths = valueParts(value).map(partWidthPx);
  const [top, right = top, bottom = top, left = right] = widths;
  const side = Math.max(right, left);
  return widths.length > 1 && side > 1 && side > Math.max(top, bottom);
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
 * @param {{definesColours?: boolean}} [options] `definesColours` for the generated tokens.css only.
 */
export function checkCss(source, typeStyles, {definesColours = false} = {}) {
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

  /** Per rule block: the style its `font` shorthand names, and the style its tracking names. */
  const blocks = new Map();
  const blockOf = (decl) => {
    if (!blocks.has(decl.block)) blocks.set(decl.block, {});
    return blocks.get(decl.block);
  };

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

    if (property === 'font' && !CASCADE_KEYWORD.test(plain)) {
      const style = typeToken(plain, '', typeStyles);
      if (style) {
        blockOf(decl).font = {decl, style};
      } else {
        push(decl, 'DF-1', 'font shorthand outside the scale - use var(--dbs-font-<style>)');
      }
    }

    const bare = withoutStrings(plain);
    if (
      !definesColours &&
      (RAW_COLOUR.test(bare) || (COLOUR_PROPERTY.test(property) && NAMED_COLOUR.test(bare)))
    ) {
      push(
        decl,
        'TOK-1',
        'raw colour - use a --dbs-* token; colours are defined in tokens.css only',
      );
    }

    if (TEXT_COLOUR_PROPERTIES.has(property)) {
      const problem = textColourProblem(plain);
      if (problem) {
        push(decl, ...problem);
      }
    }

    if (TEXT_COLOUR_SHORTHANDS.has(property)) {
      const problem = shorthandColours(plain).map(textColourProblem).find(Boolean);
      if (problem) {
        push(decl, ...problem);
      }
    }

    if (
      (SIDE_BORDER.test(property) && borderWidthPx(plain) > 1) ||
      (property === 'border-width' && borderWidthIsSideAccent(plain))
    ) {
      push(decl, 'FLOOR-8', 'side border wider than 1px - use a hairline or a full border');
    }

    if (property === 'background-clip' && /(^|[\s,])text($|[\s,])/.test(plain)) {
      push(decl, 'FLOOR-8', 'gradient text - text keeps a solid text-role colour');
    }

    if (property === 'letter-spacing') {
      blockOf(decl).tracking = typeToken(plain, '-tracking', typeStyles);
    }

    if (property === 'will-change' && value !== 'auto') {
      if (!inInteractionState(selectors)) {
        push(decl, 'PERF-5', 'resting will-change - set it only in an interaction state');
      }
    }
  }

  for (const {font, tracking} of blocks.values()) {
    if (font && tracking !== font.style) {
      push(
        font.decl,
        'DF-1',
        `font shorthand without its tracking - add letter-spacing: ` +
          `var(--dbs-font-${font.style}-tracking), or use .dbs-type-${font.style}`,
      );
    }
  }

  violations.sort((a, b) => a.line - b.line);
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
    const options = {definesColours: file === TOKENS_CSS};
    for (const v of checkCss(await readFile(full, 'utf8'), typeStyles, options)) {
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
    out.log(
      'check:css - clean. FLOOR-4, FLOOR-8, PERF-3, PERF-5, DF-1, TOK-1, TOK-4 and TOK-5 hold.',
    );
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
