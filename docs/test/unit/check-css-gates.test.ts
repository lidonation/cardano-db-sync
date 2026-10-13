import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {afterEach, beforeEach, describe, expect, it} from 'vitest';

import {
  TOKEN_SOURCE,
  TOKENS_CSS,
  checkCss,
  findViolations,
  loadTypeStyles,
  main,
} from '../../scripts/check-css-gates.mjs';

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'dbsync-css-'));
  await fs.mkdir(path.join(root, 'src'), {recursive: true});
  await writeTokenSource({base: {typography: {style: {body: {}}}}});
  await fs.mkdir(path.join(root, 'src/css'), {recursive: true});
  await fs.writeFile(
    path.join(root, TOKENS_CSS),
    ':root {--dbs-text-primary: black; --dbs-font-body-size: 16px; --dbs-font-label-size: 14px}',
  );
});

/** Every tree scan needs the token source that names the type scale. */
async function writeTokenSource(source: unknown): Promise<void> {
  await fs.mkdir(path.join(root, 'design'), {recursive: true});
  await fs.writeFile(path.join(root, TOKEN_SOURCE), JSON.stringify(source));
}

afterEach(async () => {
  await fs.rm(root, {recursive: true, force: true});
});

const rules = (css: string) =>
  checkCss(css)
    .map((v) => v.rule)
    .filter((rule) => !['TOK-15', 'TOK-16', 'TOK-17', 'REUSE-1'].includes(rule));

describe('FLOOR-4: focus outline is never removed', () => {
  it.each(['none', '0', '0px', 'none !important'])('flags `outline: %s`', (value) => {
    expect(rules(`a:focus { outline: ${value}; }`)).toEqual(['FLOOR-4']);
  });

  it('allows a restyled outline', () => {
    expect(rules('a:focus-visible { outline: 2px solid currentColor; }')).toEqual([]);
  });

  it('does not confuse outline-offset with outline', () => {
    expect(rules('a { outline-offset: 0; }')).toEqual([]);
  });
});

describe('PERF-3: layout properties are never animated', () => {
  it.each([
    'width 200ms ease',
    'opacity 1s, height 1s',
    'all 0.2s',
    'margin-left 0.3s',
    'top 1s linear',
  ])('flags `transition: %s`', (value) => {
    expect(rules(`.x { transition: ${value}; }`)).toEqual(['PERF-3']);
  });

  it('flags transition-property naming a layout property', () => {
    expect(rules('.x { transition-property: transform, width; }')).toEqual(['PERF-3']);
  });

  it('allows transform and opacity transitions', () => {
    expect(rules('.x { transition: transform 200ms ease, opacity 200ms; }')).toEqual([]);
  });

  it('does not match a layout name inside another word', () => {
    expect(rules('.x { transition: border-color 1s, box-shadow 1s; }')).toEqual([]);
  });

  it('flags layout properties inside @keyframes, vendor-prefixed too', () => {
    expect(rules('@keyframes grow { from { width: 0; } to { width: 10px; } }')).toEqual([
      'PERF-3',
      'PERF-3',
    ]);
    expect(rules('@-webkit-keyframes slide { to { left: 10px; } }')).toEqual(['PERF-3']);
  });

  it('allows layout properties in ordinary rules and transform in @keyframes', () => {
    expect(rules('.x { width: 10px; height: 2rem; }')).toEqual([]);
    expect(rules('@keyframes spin { to { transform: rotate(1turn); } }')).toEqual([]);
  });
});

describe('PERF-5: will-change only in an interaction state', () => {
  it('flags a resting will-change', () => {
    expect(rules('.card { will-change: transform; }')).toEqual(['PERF-5']);
  });

  it.each([':hover', ':focus', ':focus-visible', ':focus-within', ':active'])(
    'allows will-change under %s',
    (state) => {
      expect(rules(`.card${state} { will-change: transform; }`)).toEqual([]);
    },
  );

  it('allows will-change: auto, which releases the layer', () => {
    expect(rules('.card { will-change: auto; }')).toEqual([]);
  });

  it('judges the innermost rule, not an enclosing at-rule', () => {
    expect(rules('@media (hover: hover) { .card:hover { will-change: opacity; } }')).toEqual([]);
    expect(rules('@media (hover: hover) { .card { will-change: opacity; } }')).toEqual(['PERF-5']);
  });
});

describe('scanner', () => {
  it('ignores commented-out code and keeps line numbers', () => {
    const css = '/*\n.a { outline: none; }\n*/\n.b { will-change: top; }\n';
    const violations = checkCss(css);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({rule: 'PERF-5', line: 4, text: 'will-change: top'});
  });

  it('reads a last declaration with no trailing semicolon', () => {
    expect(rules('a { outline: none }')).toEqual(['FLOOR-4']);
  });
});

describe('DF-1: no type size outside the 13-style scale', () => {
  const scale = new Set(['body', 'label']);
  const df1 = (css: string) =>
    checkCss(css, scale)
      .map((v) => v.rule)
      .filter((rule) => rule === 'DF-1');

  it.each(['15px', '1rem', '0.9em', 'larger', 'calc(1rem + 2px)', 'var(--other-size)'])(
    'flags `font-size: %s`',
    (value) => {
      expect(df1(`p { font-size: ${value}; }`)).toEqual(['DF-1']);
    },
  );

  it('allows a scale size token, with or without !important', () => {
    expect(df1('p { font-size: var(--dbs-font-body-size); }')).toEqual([]);
    expect(df1('p { font-size: var(--dbs-font-label-size) !important; }')).toEqual([]);
  });

  it('flags a size token for a style the scale does not have', () => {
    expect(df1('p { font-size: var(--dbs-font-huge-size); }')).toEqual(['DF-1']);
  });

  it.each(['inherit', 'initial', 'unset', 'revert', 'revert-layer'])(
    'allows `font-size: %s`, which defers to the cascade',
    (value) => {
      expect(df1(`p { font-size: ${value}; }`)).toEqual([]);
    },
  );

  it('requires the font shorthand to be a style token, not a literal or a family', () => {
    expect(df1('p { font: 600 14px/1.2 Inter, sans-serif; }')).toEqual(['DF-1']);
    expect(df1('p { font: var(--dbs-font-ui); }')).toEqual(['DF-1']);
    expect(
      df1(
        'p { font: var(--dbs-font-label); letter-spacing: var(--dbs-font-label-tracking); line-height: 44px; }',
      ),
    ).toEqual([]);
  });

  describe('a font shorthand keeps its tracking', () => {
    const messages = (css: string) => checkCss(css, scale).map((v) => v.message);

    it('flags a shorthand with no tracking, pointing at the token and the class', () => {
      expect(messages('p { font: var(--dbs-font-label); }')).toEqual([
        'font shorthand without its tracking - add letter-spacing: var(--dbs-font-label-tracking), or use .dbs-type-label',
      ]);
    });

    it.each([
      ['another style', 'var(--dbs-font-body-tracking)'],
      ['a literal', '0.5px'],
    ])('flags tracking from %s', (_label, tracking) => {
      expect(df1(`p { font: var(--dbs-font-label); letter-spacing: ${tracking}; }`)).toEqual([
        'DF-1',
      ]);
    });

    it('pairs within one rule block, not across blocks or at-rules', () => {
      expect(
        df1(
          '@media (min-width: 1px) { p { font: var(--dbs-font-label); } } p { letter-spacing: var(--dbs-font-label-tracking); }',
        ),
      ).toEqual(['DF-1']);
    });

    it('leaves a letter-spacing alone when the block sets no font shorthand', () => {
      expect(df1('p { letter-spacing: 0.02em; }')).toEqual([]);
    });
  });

  it('leaves custom property definitions alone', () => {
    expect(df1(':root { --dbs-font-body-size: 15px; --ifm-font-size-base: 15px; }')).toEqual([]);
  });
});

describe('TOK-5 / TOK-4: only text-role tokens in a text-colour position', () => {
  it.each([
    'var(--dbs-text-primary)',
    'var(--dbs-code-text-muted)',
    'var(--dbs-accent-primary-text)',
    'currentColor',
    'inherit',
  ])('allows `color: %s`', (value) => {
    expect(rules(`p { color: ${value}; }`)).toEqual([]);
  });

  it.each([
    ['color', 'var(--dbs-surface-base)'],
    ['color', 'var(--dbs-accent-primary)'],
    ['caret-color', 'var(--dbs-border-default)'],
    ['-webkit-text-fill-color', 'transparent'],
    ['text-decoration-color', 'var(--ifm-color-primary)'],
  ])('flags `%s: %s`', (property, value) => {
    expect(rules(`p { ${property}: ${value}; }`)).toEqual(['TOK-5']);
  });

  it('names a brand token in a text position as TOK-4', () => {
    expect(rules('p { color: var(--dbs-brand-intersect-navy); }')).toEqual(['TOK-4']);
  });

  it('leaves non-text colour positions to the other rules', () => {
    expect(rules('p { background: var(--dbs-brand-intersect-navy); }')).toEqual([]);
  });
});

describe('TOK-1: no raw colour outside tokens.css', () => {
  it.each([
    '#fff',
    '#0F1117',
    '#0f1117cc',
    'rgb(0 0 0)',
    'rgba(0,0,0,.5)',
    'hsl(200 50% 50%)',
    'oklch(70% 0.1 200)',
  ])('flags `%s`, in a property or a custom property', (colour) => {
    expect(rules(`p { background: ${colour}; }`)).toEqual(['TOK-1']);
    expect(rules(`:root { --brand: ${colour}; }`)).toEqual(['TOK-1']);
  });

  it('allows tokens and a url(#id) reference', () => {
    expect(rules('p { background: var(--dbs-surface-base); filter: url(#bead); }')).toEqual([]);
  });

  it('lets the generated tokens.css define colours', () => {
    expect(checkCss(':root { --dbs-x: #fff; }', undefined, {definesColours: true})).toEqual([]);
  });
});

describe('FLOOR-8: no thick side borders, no gradient text', () => {
  it.each([
    'border-left: 3px solid var(--dbs-accent-primary)',
    'border-right-width: 2px',
    'border-inline-start: 0.25rem solid',
    'border-inline-end: medium solid',
  ])('flags `%s`', (decl) => {
    expect(rules(`.card { ${decl}; }`)).toEqual(['FLOOR-8']);
  });

  it.each([
    'border-left: 1px solid var(--dbs-border-default)',
    'border: 2px solid var(--dbs-border-default)',
    'border-left: 0',
  ])('allows `%s`', (decl) => {
    expect(rules(`.card { ${decl}; }`)).toEqual([]);
  });

  it.each(['background-clip: text', '-webkit-background-clip: text'])('flags `%s`', (decl) => {
    expect(rules(`h1 { ${decl}; }`)).toEqual(['FLOOR-8']);
  });
});

describe('check:css over a tree', () => {
  it('scans .css and .scss and names the file', async () => {
    await fs.writeFile(path.join(root, 'src', 'a.css'), 'a { outline: none; }\n');
    await fs.writeFile(path.join(root, 'src', 'b.scss'), '.b { will-change: top; }\n');
    const violations = await findViolations(root);
    expect(violations.map((v) => `${v.file}:${v.rule}`).sort()).toEqual([
      'src/a.css:FLOOR-4',
      'src/b.scss:PERF-5',
    ]);
  });

  it('reads the type scale from the token source', async () => {
    expect(await loadTypeStyles(root)).toEqual(new Set(['body']));
    await fs.writeFile(
      path.join(root, 'src', 'a.css'),
      'p { font-size: var(--dbs-font-body-size); } q { font-size: var(--dbs-font-label-size); }',
    );
    expect((await findViolations(root)).map((v) => v.text)).toEqual([
      'font-size: var(--dbs-font-label-size)',
    ]);
  });

  it('lets only the generated tokens.css define colours', async () => {
    await fs.mkdir(path.join(root, path.dirname(TOKENS_CSS)), {recursive: true});
    await fs.writeFile(path.join(root, TOKENS_CSS), ':root { --dbs-x: #fff; }');
    await fs.writeFile(path.join(root, 'src', 'a.css'), ':root { --x: #fff; }');
    expect((await findViolations(root)).map((v) => `${v.file}:${v.rule}`)).toEqual([
      'src/a.css:TOK-1',
    ]);
  });

  it('fails when the token source has no type scale', async () => {
    await writeTokenSource({base: {}});
    await expect(loadTypeStyles(root)).rejects.toThrow(/no base.typography.style/);
  });

  it('fails rather than passing every font token when the token source is missing', async () => {
    await fs.rm(path.join(root, TOKEN_SOURCE));
    await fs.writeFile(path.join(root, 'src', 'a.css'), 'p { font: var(--dbs-font-ui); }');
    await expect(findViolations(root)).rejects.toThrow(/not found - DF-1 cannot check/);
  });

  it('skips build output, dependencies, tests and non-style files', async () => {
    for (const dir of ['build', 'node_modules', '.docusaurus', 'test']) {
      await fs.mkdir(path.join(root, dir), {recursive: true});
      await fs.writeFile(path.join(root, dir, 'x.css'), 'a { outline: none; }');
    }
    await fs.writeFile(path.join(root, 'src', 'notes.md'), '`outline: none`');
    expect(await findViolations(root)).toEqual([]);
  });
});

describe('check:css CLI reporting', () => {
  function recorder() {
    const lines: string[] = [];
    return {
      lines,
      log: (msg: string) => lines.push(msg),
      error: (msg: string) => lines.push(msg),
    };
  }

  it('exits 0 and says so when the tree is clean', async () => {
    const out = recorder();
    expect(await main(root, out)).toBe(0);
    expect(out.lines.join('\n')).toContain('clean');
  });

  it('exits 1 with a readable line per violation', async () => {
    await fs.writeFile(
      path.join(root, 'src', 'bad.css'),
      'a:focus { outline: none; }\n.m { transition: height 1s; }\n.c { will-change: transform; }\n',
    );
    const out = recorder();
    expect(await main(root, out)).toBe(1);
    const report = out.lines.join('\n');
    expect(report).toContain('4 violation(s)');
    expect(report).toContain('src/bad.css:1  FLOOR-4');
    expect(report).toContain('src/bad.css:2  PERF-3');
    expect(report).toContain('src/bad.css:3  PERF-5');
    expect(report).toContain('outline: none');
  });
});

describe('gaps closed in review', () => {
  it.each(['outline-style: none', 'outline-width: 0', 'outline-width: 0px !important'])(
    'flags `%s` as FLOOR-4',
    (decl) => {
      expect(rules(`a:focus { ${decl}; }`)).toEqual(['FLOOR-4']);
    },
  );

  it('allows a visible outline-style and width', () => {
    expect(rules('a:focus-visible { outline-style: solid; outline-width: 2px; }')).toEqual([]);
  });

  it('flags a vendor-prefixed transition of a layout property', () => {
    expect(rules('a { -webkit-transition: height 1s; }')).toEqual(['PERF-3']);
  });

  it('flags will-change when only part of a selector list is in an interaction state', () => {
    expect(rules('.a, .b:hover { will-change: transform; }')).toEqual(['PERF-5']);
    expect(rules('.a:hover, .b:focus-visible { will-change: transform; }')).toEqual([]);
  });

  it('looks through an at-rule nested inside the interaction-state rule', () => {
    expect(rules('.a:hover { @media (min-width: 1px) { will-change: transform; } }')).toEqual([]);
  });

  it('skips only the top-level test directory', async () => {
    await fs.mkdir(path.join(root, 'test'), {recursive: true});
    await fs.mkdir(path.join(root, 'src', 'test'), {recursive: true});
    await fs.writeFile(path.join(root, 'test', 'fixture.css'), 'a { outline: none; }');
    await fs.writeFile(path.join(root, 'src', 'test', 'real.css'), 'a { outline: none; }');
    expect((await findViolations(root)).map((v) => v.file)).toEqual(['src/test/real.css']);
  });
});

describe('B03 gaps closed in review', () => {
  it.each([
    'background: white',
    'border-color: RebeccaPurple',
    'outline: 2px solid black',
    'box-shadow: 0 0 0 1px red',
  ])('TOK-1 flags a named colour: `%s`', (decl) => {
    expect(rules(`p { ${decl}; }`)).toEqual(['TOK-1']);
  });

  it('TOK-1 flags a named colour in a custom property', () => {
    expect(rules(':root { --accent: tomato; }')).toEqual(['TOK-1']);
  });

  it.each([
    'background: transparent',
    'border-color: currentColor',
    'transition: color 0.2s, background-color 0.2s',
    'grid-template-areas: "red gold"',
    'content: "#fade"',
    'mask: url("#bead")',
    "filter: url('#cafe')",
  ])('TOK-1 leaves `%s` alone', (decl) => {
    expect(rules(`p { ${decl}; }`)).toEqual([]);
  });

  it.each([
    'border-inline: 3px solid var(--dbs-border-default)',
    'border-inline-width: 2px',
    'border-width: 0 0 0 4px',
    'border-width: 1px 3px',
    'border-left: var(--dbs-space-4) solid var(--dbs-border-default)',
    'border-inline-start-width: var(--dbs-radius-sm)',
  ])('FLOOR-8 flags `%s`', (decl) => {
    expect(rules(`.card { ${decl}; }`)).toEqual(['FLOOR-8']);
  });

  it.each(['border-width: 2px', 'border-width: 3px 1px', 'border-inline: 1px solid'])(
    'FLOOR-8 allows `%s`',
    (decl) => {
      expect(rules(`.card { ${decl}; }`)).toEqual([]);
    },
  );

  it.each([
    ['text-decoration', 'underline var(--dbs-border-default)'],
    ['text-emphasis', 'dot var(--dbs-accent-primary)'],
  ])('TOK-5 checks the colour inside the `%s` shorthand', (property, value) => {
    expect(rules(`a { ${property}: ${value}; }`)).toEqual(['TOK-5']);
  });

  it.each([
    'text-decoration: underline',
    'text-decoration: underline var(--dbs-accent-primary-text)',
    'text-decoration: none',
  ])('TOK-5 allows `%s`', (decl) => {
    expect(rules(`a { ${decl}; }`)).toEqual([]);
  });
});
