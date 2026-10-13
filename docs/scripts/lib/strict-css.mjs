import {lineIndex} from './build-output.mjs';
import {declarations, stripComments} from './css-declarations.mjs';
import {CSS_GATE_ALLOWLIST} from './css-gate-allowlist.mjs';

const LENGTH = /(?<![\w-])[-+]?(?:\d*\.)?\d+(?:px|rem|em|ch)\b/i;
const SPACING =
  /^(?:scroll-)?(?:padding|margin)(?:-.+)?$|^(?:gap|row-gap|column-gap)$|^inset(?:-.+)?$|^(?:top|right|bottom|left)$|offset$/;
const SIZE = /^(?:(?:min-|max-)?(?:width|height|inline-size|block-size)|flex-basis)$/;
const BORDER =
  /^border(?:-(?:top|right|bottom|left|block|inline)(?:-(?:start|end))?)?(?:-width)?$|^outline-width$/;
const CASCADE = /^(?:inherit|initial|unset|revert|revert-layer)$/;

/** Blank token names so numbers in names never count as lengths; raw fallbacks still count. */
function withoutVariables(value) {
  return value.replace(/var\(\s*--[\w-]+\s*\)/g, '');
}

/** Strict token and shared-rule checks; generated tokens and font-face descriptors are exempt. */
export function checkStrictCss(
  source,
  {file = '', knownTokens, breakpoints = [768, 1024, 1280]} = {},
) {
  if (file === 'src/css/tokens.css') return [];
  const css = stripComments(source);
  const lineAt = lineIndex(css);
  const ds = [...declarations(css)].filter(
    (d) => !d.selectors.some((s) => /^@font-face\b/i.test(s)),
  );
  const local = new Set(ds.filter((d) => d.property.startsWith('--')).map((d) => d.property));
  const problems = [];
  const add = (d, rule, message) =>
    problems.push({line: lineAt(d.offset), rule, message, text: `${d.property}: ${d.value}`});
  const blocks = new Map();
  for (const media of css.matchAll(/@media\b([^{};]*)\{/g)) {
    for (const m of media[1].matchAll(/(\d+(?:\.\d+)?)px\b/g)) {
      if (!breakpoints.some((b) => Number(m[1]) === b || Number(m[1]) === b - 1))
        problems.push({
          line: lineAt(media.index),
          rule: 'TOK-16',
          message: `media threshold ${m[0]} - use breakpoint.sm/md/lg (${breakpoints.join('/')}px), or its value minus 1px`,
          text: media[0],
          threshold: m[0],
        });
    }
  }
  for (const d of ds) {
    const p = d.property.replace(/^-[a-z]+-/, '');
    const v = d.value.replace(/\s*!important$/i, '');
    const bare = withoutVariables(v);
    if (!blocks.has(d.block)) blocks.set(d.block, []);
    blocks.get(d.block).push(d);
    if (knownTokens)
      for (const m of v.matchAll(/var\(\s*(--dbs-[\w-]+)/g)) {
        if (!knownTokens.has(m[1]) && !local.has(m[1]))
          add(
            d,
            'TOK-16',
            `undefined token ${m[1]} - use a token declared in src/css/tokens.css or declare a local --dbs-* alias`,
          );
      }
    if (p.startsWith('--')) continue;
    if (SPACING.test(p) && LENGTH.test(bare))
      add(d, 'TOK-15', 'raw spacing length - use var(--dbs-space-*) or a named offset token');
    if (SIZE.test(p) && LENGTH.test(bare))
      add(d, 'TOK-16', 'raw layout length - use var(--dbs-layout-*) or var(--dbs-size-*)');
    if (
      BORDER.test(p) &&
      (LENGTH.test(bare) ||
        /\b(?:thin|medium|thick)\b/.test(bare) ||
        (p.endsWith('-width') && /var\(\s*--dbs-(?:space|radius|layout|motion|layer)-/.test(v)))
    )
      add(
        d,
        'TOK-16',
        'border width is not a border-width token - use var(--dbs-border-width-hairline) or var(--dbs-border-width-emphasis)',
      );
    if (/^(?:transition|animation)(?:-.+)?$/.test(p) && /(?<![\w-])(?:\d*\.)?\d+m?s\b/.test(bare))
      add(d, 'TOK-16', 'raw motion duration - use var(--dbs-motion-*)');
    if (p === 'z-index' && /(?<![\w-])[-+]?(?:\d*\.)?\d+\b/.test(bare))
      add(d, 'TOK-16', 'raw stacking layer - use var(--dbs-layer-*)');
    if (
      /^(?:font-weight|line-height|letter-spacing)$/.test(p) &&
      !CASCADE.test(v) &&
      !/^var\(\s*--[\w-]+\s*\)$/.test(v)
    )
      add(
        d,
        'TOK-17',
        'standalone type literal - use .dbs-type-* or the generated font and --dbs-font-*-tracking pair',
      );
  }
  for (const block of blocks.values()) {
    const font = block.find((d) => d.property === 'font');
    const tracking = block.find((d) => d.property === 'letter-spacing');
    const selector = block[0].selectors.filter((s) => !s.startsWith('@')).join(' ');
    const style = /^var\(--dbs-font-([\w-]+)\)$/.exec(
      font?.value.replace(/\s*!important$/i, '') ?? '',
    )?.[1];
    if (
      style &&
      tracking?.value.replace(/\s*!important$/i, '') === `var(--dbs-font-${style}-tracking)` &&
      !block[0].selectors.some((s) => /^@media\b/.test(s)) &&
      !selector.includes(`.dbs-type-${style}`)
    )
      add(font, 'REUSE-1', `repeated generated type pair - use .dbs-type-${style}`);
    const outline = block.find(
      (d) =>
        d.property === 'outline' && /^var\(--dbs-focus-ring\)(?:\s*!important)?$/.test(d.value),
    );
    if (
      outline &&
      block.some((d) => d.property === 'outline-offset') &&
      file !== 'src/css/custom.css' &&
      !/:has\(|(?:^|[\s.#[-])demo(?:[\w-]*|\b)/i.test(selector)
    )
      add(
        outline,
        'REUSE-1',
        'duplicate focus ring - reuse the global focus rule in src/css/custom.css',
      );
  }
  return problems.filter(
    (p) =>
      !CSS_GATE_ALLOWLIST.some(
        (e) =>
          e.file === file &&
          e.rule === p.rule &&
          (e.text === p.text || (e.threshold && e.threshold === p.threshold)) &&
          e.reason?.trim(),
      ),
  );
}
