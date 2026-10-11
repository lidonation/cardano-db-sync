import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {afterEach, beforeEach, describe, expect, it} from 'vitest';

import {
  TOKEN_SOURCE,
  checkCss,
  findViolations,
  loadTypeStyles,
  main,
} from '../../scripts/check-css-gates.mjs';

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'dbsync-css-'));
  await fs.mkdir(path.join(root, 'src'), {recursive: true});
});

afterEach(async () => {
  await fs.rm(root, {recursive: true, force: true});
});

const rules = (css: string) => checkCss(css).map((v) => v.rule);

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
  const df1 = (css: string) => checkCss(css, scale).map((v) => v.rule);

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
    expect(df1('p { font: var(--dbs-font-label); line-height: 44px; }')).toEqual([]);
  });

  it('leaves custom property definitions alone', () => {
    expect(df1(':root { --dbs-font-body-size: 15px; --ifm-font-size-base: 15px; }')).toEqual([]);
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
    await fs.mkdir(path.join(root, 'design'));
    await fs.writeFile(
      path.join(root, TOKEN_SOURCE),
      JSON.stringify({base: {typography: {style: {body: {}}}}}),
    );
    expect(await loadTypeStyles(root)).toEqual(new Set(['body']));
    await fs.writeFile(
      path.join(root, 'src', 'a.css'),
      'p { font-size: var(--dbs-font-body-size); } q { font-size: var(--dbs-font-label-size); }',
    );
    expect((await findViolations(root)).map((v) => v.text)).toEqual([
      'font-size: var(--dbs-font-label-size)',
    ]);
  });

  it('fails when the token source has no type scale', async () => {
    await fs.mkdir(path.join(root, 'design'));
    await fs.writeFile(path.join(root, TOKEN_SOURCE), JSON.stringify({base: {}}));
    await expect(loadTypeStyles(root)).rejects.toThrow(/no base.typography.style/);
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
    expect(report).toContain('3 violation(s)');
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
