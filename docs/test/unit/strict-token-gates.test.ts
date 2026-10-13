import {describe, expect, it} from 'vitest';
import {checkStrictCss} from '../../scripts/lib/strict-css.mjs';
import {findBorderProblems} from '../../scripts/check-token-lint.mjs';
import {checkCss} from '../../scripts/check-css-gates.mjs';
import {findJsxTokenProblems} from '../../scripts/lib/jsx-token-lint.mjs';

const options = {
  file: 'src/example.css',
  knownTokens: new Set(['--dbs-space-8']),
  breakpoints: [768, 1024, 1280],
};
const rules = (css: string) => checkStrictCss(css, options).map((v) => v.rule);
describe('strict CSS token rules', () => {
  it.each([
    'padding: 2px',
    'margin-inline: calc(var(--dbs-space-8) + 1rem)',
    'gap: 1ch',
    'inset-block-end: -2em',
    'outline-offset: 2px',
  ])('TOK-15 rejects %s', (d) => expect(rules(`a { ${d}; }`)).toContain('TOK-15'));
  it.each(['padding: 0 20%', 'gap: var(--dbs-space-8)', 'margin: calc(10% - var(--dbs-space-8))'])(
    'TOK-15 allows %s',
    (d) => expect(rules(`a { ${d}; }`)).toEqual([]),
  );
  it.each([
    'width: 12px',
    'border: 1px solid currentColor',
    'border-inline-width: thin',
    'outline-width: 2rem',
    'transition: opacity 100ms',
    'animation: fade .2s',
    'z-index: 0',
  ])('TOK-16 rejects %s', (d) => expect(rules(`a { ${d}; }`)).toContain('TOK-16'));
  it.each(['border: 0 solid currentColor', 'border: none', 'width: 100%', 'z-index: auto'])(
    'TOK-16 allows %s',
    (d) => expect(rules(`a { ${d}; }`)).toEqual([]),
  );
  it.each(['font-weight: 700', 'line-height: 1.5', 'letter-spacing: .1em'])(
    'TOK-17 rejects %s',
    (d) => expect(rules(`a { ${d}; }`)).toContain('TOK-17'),
  );
  it('exempts generated tokens and font faces', () => {
    expect(checkStrictCss('a {padding: 2px}', {...options, file: 'src/css/tokens.css'})).toEqual(
      [],
    );
    expect(rules('@font-face {font-weight: 700; font-size: 12px}')).toEqual([]);
  });
  it('checks references including fallbacks and permits file-local declarations', () => {
    expect(rules('a {gap: var(--dbs-missing, var(--dbs-space-8))}')).toContain('TOK-16');
    expect(rules('a {--dbs-local: 2px; gap: var(--dbs-local)}')).toEqual([]);
  });
  it('validates media thresholds', () => {
    expect(rules('@media (max-width: 767px) {a {margin: 0}}')).toEqual([]);
    expect(rules('@media (width >= 800px) {a {margin: 0}}')).toContain('TOK-16');
  });
  it('flags ordinary focus rings but allows demo, has and the shared rule', () => {
    const css = 'a:focus-visible {outline: var(--dbs-focus-ring); outline-offset: 0}';
    const opts = {...options, knownTokens: new Set(['--dbs-focus-ring'])};
    expect(checkStrictCss(css, opts).map((v) => v.rule)).toContain('REUSE-1');
    for (const selector of ['.demo a', 'a:has(input)'])
      expect(checkStrictCss(css.replace('a:focus-visible', selector), opts)).toEqual([]);
    expect(checkStrictCss(css, {...opts, file: 'src/css/custom.css'})).toEqual([]);
  });
  it('flags generated type pairs except utilities and responsive overrides', () => {
    const css = 'a {font: var(--dbs-font-body); letter-spacing: var(--dbs-font-body-tracking)}';
    const opts = {
      ...options,
      knownTokens: new Set(['--dbs-font-body', '--dbs-font-body-tracking']),
    };
    expect(checkStrictCss(css, opts).map((v) => v.rule)).toContain('REUSE-1');
    expect(checkStrictCss('@media (min-width: 768px) {' + css + '}', opts)).toEqual([]);
    expect(checkStrictCss(css.replace('a {', '.dbs-type-body {'), opts)).toEqual([]);
  });
});
describe('TS compiler JSX inspection', () => {
  it.each([
    '<div style={{padding: 4}} />',
    '<div style={{margin: "2rem", color: "red"}} />',
    '<svg><path strokeWidth={1.5}/></svg>',
    '<svg width="24"/>',
    '<svg><text fontSize={12}/></svg>',
  ])('rejects raw presentation: %s', (s) =>
    expect(findJsxTokenProblems('src/a.tsx', s).length).toBeGreaterThan(0),
  );
  it.each([
    '<div style={{padding: props.padding, color: "var(--dbs-text-primary)"}}/>',
    '<svg width={ICON_SIZE}><path d="M0 0L24 24" x={2} r={3}/></svg>',
    '<Widget width={24}/>',
    '<div>{/* style={{padding: 4}} */}</div>',
  ])('allows token and geometry: %s', (s) =>
    expect(findJsxTokenProblems('src/a.tsx', s)).toEqual([]),
  );
});

describe('adversarial fixtures', () => {
  it('permits the footer separator but not a footer control', () => {
    expect(
      findBorderProblems(
        'src/components/Footer/styles.module.css',
        '.footer {border-top: var(--dbs-border-width-hairline) solid var(--dbs-border-default)}',
      ),
    ).toEqual([]);
    expect(
      findBorderProblems(
        'src/components/Footer/styles.module.css',
        '.footer button {border: var(--dbs-border-width-hairline) solid var(--dbs-border-default)}',
      ).map((v) => v.rule),
    ).toEqual(['TOK-6']);
  });
  it('permits layout, size, border and motion tokens with colour tokens', () => {
    const css =
      'a {width: var(--dbs-size-control); max-inline-size: var(--dbs-layout-content-max); border: var(--dbs-border-width-hairline) solid var(--dbs-border-default); transition: opacity var(--dbs-motion-fast); z-index: var(--dbs-layer-nav)}';
    expect(checkStrictCss(css)).toEqual([]);
  });
  it.each([
    'padding-block-start: calc(10% + calc(2px * 3))',
    'scroll-margin-inline-end: 1rem',
    'gap: var(--dbs-space-8, 2px)',
  ])('catches nested or fallback spacing %s', (d) =>
    expect(checkStrictCss(`a {${d}}`).map((v) => v.rule)).toContain('TOK-15'),
  );
  it('checks empty media rules at their source line', () => {
    expect(checkStrictCss('\n@media (min-width: 800px) {}')[0]).toMatchObject({
      rule: 'TOK-16',
      line: 2,
    });
  });
  it('keeps SVG path geometry and keyframe transforms exempt', () => {
    expect(
      checkStrictCss(
        'path {d: path("M 0 0 L 24 24")} @keyframes fade {from {transform: translateX(2px)} to {opacity: 1}}',
      ),
    ).toEqual([]);
  });
  it('enforces TOK-18 through the existing TOK-5 role gate', () => {
    expect(checkCss('a {color: var(--dbs-surface-base)}').map((v) => v.rule)).toContain('TOK-5');
    expect(checkCss('a {color: var(--dbs-text-kicker)}')).toEqual([]);
  });
  it.each([
    'const size = 24; const x = <svg width={size}/>;',
    '<div style={{gap: "var(--dbs-space-8, 2px)"}}/>',
  ])('rejects alias and fallback literals: %s', (s) =>
    expect(findJsxTokenProblems('src/a.tsx', s).length).toBeGreaterThan(0),
  );
  it.each([
    'import {SIZE} from "@site/src/lib/icons"; const x = <svg width={SIZE}/>;',
    'const x = <div style={{opacity: .5, width: "100%", padding: 0, borderWidth: 0, background: "url(icon.svg)"}}/>;',
    'const x = <svg viewBox="0 0 24 24"><polygon points="0,0 24,24" cx={12} cy={12} r={12}/></svg>',
  ])('permits constants and geometry: %s', (s) =>
    expect(findJsxTokenProblems('src/a.tsx', s)).toEqual([]),
  );
});

it('permits only the documented content breakpoint in its reviewed file', () => {
  expect(
    checkStrictCss('@media (max-width: 440px) {}', {file: 'src/updates/styles.module.css'}),
  ).toEqual([]);
  expect(
    checkStrictCss('@media (max-width: 479px) {}', {file: 'src/numbers/styles.module.css'}),
  ).toEqual([]);
  expect(
    checkStrictCss('@media (max-width: 441px) {}', {file: 'src/updates/styles.module.css'}).map(
      (v) => v.rule,
    ),
  ).toEqual(['TOK-16']);
  expect(
    checkStrictCss('@media (max-width: 440px) {}', {file: 'src/landing/styles.module.css'}).map(
      (v) => v.rule,
    ),
  ).toEqual(['TOK-16']);
});

describe('scope, spreads and precise exceptions', () => {
  it('resolves lexical bindings without unrelated shadowing', () => {
    expect(
      findJsxTokenProblems(
        'a.tsx',
        'const gap=4;const x=<div style={{gap:gap}}/>;function A(){const gap=props.gap;}',
      ),
    ).toHaveLength(1);
    expect(
      findJsxTokenProblems(
        'a.tsx',
        'function A({size}){return <svg width={size}/>};function B(){const size=24;}',
      ),
    ).toEqual([]);
  });
  it.each([
    'const padding=4;const x=<div style={{padding}}/>',
    'const styles={padding:4};const x=<div style={{...styles}}/>',
  ])('checks static object members %s', (source) =>
    expect(findJsxTokenProblems('a.tsx', source)).toHaveLength(1),
  );
  it('ignores colour names in asset URLs', () =>
    expect(
      findJsxTokenProblems('a.tsx', 'const x=<div style={{background:"url(red.svg)"}}/>'),
    ).toEqual([]));
  it('rejects nonpixel layout media thresholds, not resolution', () => {
    expect(rules('@media (min-width:50em){}')).toContain('TOK-16');
    expect(rules('@media (resolution:2dppx){}')).toEqual([]);
  });
  it('does not extend an exception to unrelated selectors', () => {
    expect(
      checkStrictCss(
        'a {font:var(--dbs-font-label);letter-spacing:var(--dbs-font-label-tracking)}',
        {file: 'src/css/switchers.css'},
      ).map((p) => p.rule),
    ).toContain('REUSE-1');
    expect(
      checkStrictCss('@media (min-width:440px){}', {file: 'src/updates/styles.module.css'}).map(
        (p) => p.rule,
      ),
    ).toContain('TOK-16');
  });
});

describe('additional static-resolution safety', () => {
  it.each([
    'const padding=4;function A({padding}){return <div style={{padding}}/>}',
    'const style={padding:4};function A({style}){return <div style={{...style}}/>}',
    'const a=b;const b=a;const x=<div style={{...a}}/>',
  ])('preserves dynamic inputs and terminates cycles: %s', (source) =>
    expect(findJsxTokenProblems('a.tsx', source)).toEqual([]),
  );
  it('finds a colour beside a URL', () =>
    expect(
      findJsxTokenProblems('a.tsx', 'const x=<div style={{background:"url(red.svg) blue"}}/>'),
    ).toHaveLength(1));
  it.each(['50rem', '50vw', '50cm'])('rejects nonpixel breakpoint %s', (length) =>
    expect(rules(`@media (width >= ${length}){}`)).toContain('TOK-16'),
  );
  it.each([
    '.navbar__item.dropdown > .navbar__link',
    '.dropdown__link',
    '.dropdown__link--active,\n.dropdown__link--active:hover',
  ])('allows only reviewed switcher selector %s', (selector) =>
    expect(
      checkStrictCss(
        `${selector} {font: var(--dbs-font-label);letter-spacing:var(--dbs-font-label-tracking)}`,
        {file: 'src/css/switchers.css'},
      ),
    ).toEqual([]),
  );
});
