import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {afterEach, beforeEach, describe, expect, it} from 'vitest';

import {checkCss, findViolations, main} from '../../scripts/check-css-gates.mjs';

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
