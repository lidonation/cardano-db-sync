import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {afterEach, beforeEach, describe, expect, it} from 'vitest';

import {
  RETIRED_TOKENS,
  SOURCE,
  TOKENS_CSS,
  findBorderProblems,
  findCodeProblems,
  findNavProblems,
  findOverrideProblems,
  findViolations,
  flatten,
  hasSidebarBinding,
  isDecorativeBorder,
  main,
  varName,
} from '../../scripts/check-token-lint.mjs';

let root: string;

function recorder() {
  const lines: string[] = [];
  return {lines, out: {log: (m: string) => lines.push(m), error: (m: string) => lines.push(m)}};
}

async function write(file: string, text: string): Promise<void> {
  await fs.mkdir(path.dirname(path.join(root, file)), {recursive: true});
  await fs.writeFile(path.join(root, file), text);
}

const SOURCE_OK = {
  _meta: {_comment: 'ignored'},
  base: {surface: {base: '#ffffff', raised: '#f0f2f5'}, typography: {style: {body: {}}}},
  dark: {surface: {base: '#0f1117'}},
};

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'dbsync-token-lint-'));
  await write(SOURCE, JSON.stringify(SOURCE_OK));
  // NAV-5 is tree-wide: every fixture tree carries the sidebar binding unless the test
  // overwrites it.
  await write(
    'src/css/custom.css',
    '.menu__link--active { color: var(--dbs-accent-primary-text); }',
  );
});

afterEach(async () => {
  await fs.rm(root, {recursive: true, force: true});
});

describe('flatten and varName', () => {
  it('flattens a set to dotted leaves, skipping metadata and the type scale', () => {
    expect(
      Object.fromEntries(flatten({_x: 1, typography: {}, a: {b: '#1', c: {$value: '#2'}}})),
    ).toEqual({'a.b': '#1', 'a.c': '#2'});
  });

  it('names tokens the way the generator does', () => {
    expect(varName('accent.primary-inverse-hover')).toBe('--dbs-accent-primary-inverse-hover');
  });
});

describe('THM-4 / TOK-12: theme overrides must change something', () => {
  it('passes real overrides', () => {
    expect(findOverrideProblems(SOURCE_OK)).toEqual([]);
  });

  it('flags an override equal to base, and one base does not define', () => {
    const problems = findOverrideProblems({
      base: {surface: {base: '#ffffff'}},
      cream: {surface: {base: '#ffffff', ghost: '#000000'}},
    });
    expect(problems.map((p) => `${p.set}.${p.name}`)).toEqual([
      'cream.surface.base',
      'cream.surface.ghost',
    ]);
    expect(problems[0].message).toMatch(/no-op override/);
    expect(problems[1].message).toMatch(/base set does not define/);
  });
});

describe('TOK-1 / TOK-10 in code', () => {
  it('flags a hex colour string in component code, not a hex-free anchor', () => {
    const problems = findCodeProblems('src/a.tsx', "const c = '#0f1117';\nconst a = '#faq-item';");
    expect(problems).toEqual([
      {line: 1, rule: 'TOK-1', message: "colour literal '#0f1117' - use a --dbs-* token"},
    ]);
  });

  it('leaves hex in stylesheets to check:css', () => {
    expect(findCodeProblems('src/a.css', "a { content: '#fff'; }")).toEqual([]);
  });

  it.each(RETIRED_TOKENS)('flags a reference to the retired %s', (dotted) => {
    const problems = findCodeProblems('src/a.css', `a { background: var(${varName(dotted)}); }`);
    expect(problems.map((p) => p.rule)).toEqual(['TOK-10']);
  });

  it('does not mistake a longer token for a retired one', () => {
    expect(findCodeProblems('src/a.css', 'a { color: var(--dbs-border-inverse-x); }')).toEqual([]);
  });

  it('lets tokens.css define a retired token but not use one', () => {
    expect(findCodeProblems(TOKENS_CSS, '  --dbs-border-inverse: #30363d;')).toEqual([]);
    expect(
      findCodeProblems(TOKENS_CSS, '  --dbs-x: var(--dbs-border-inverse);').map((p) => p.rule),
    ).toEqual(['TOK-10']);
  });
});

describe('check:token-lint over a tree', () => {
  it('scans site source, skipping tests, the design folder, scripts and dependencies', async () => {
    const bad = "const c = '#fff';";
    for (const file of ['test/a.ts', 'design/a.ts', 'scripts/a.mjs', 'node_modules/x/a.js']) {
      await write(file, bad);
    }
    await write('src/pages/index.tsx', bad);
    expect((await findViolations(root)).map((v) => `${v.file}:${v.line}`)).toEqual([
      'src/pages/index.tsx:1',
    ]);
  });

  it('exits 0 when clean', async () => {
    const {lines, out} = recorder();
    expect(await main({root, out})).toBe(0);
    expect(lines.join('\n')).toMatch(/clean/);
  });

  it('exits 1 listing source and code violations', async () => {
    await write(SOURCE, JSON.stringify({...SOURCE_OK, dark: {surface: {base: '#ffffff'}}}));
    await write('src/a.tsx', "const c = '#fff';");
    const {lines, out} = recorder();
    expect(await main({root, out})).toBe(1);
    expect(lines.join('\n')).toMatch(/dark\.surface\.base {2}TOK-12 {2}no-op override/);
    expect(lines.join('\n')).toMatch(/src\/a\.tsx:1 {2}TOK-1/);
  });

  it('cannot run, rather than passing, without the token source', async () => {
    await fs.rm(path.join(root, SOURCE));
    const {lines, out} = recorder();
    expect(await main({root, out})).toBe(2);
    expect(lines.join('\n')).toMatch(/cannot read/);
  });
});

describe('TOK-6: control boundaries bind border.interactive (B35)', () => {
  it('allows only the static landing pipeline frame, never a FAQ control', () => {
    const file = 'src/landing/styles.module.css';
    expect(
      findBorderProblems(file, '.stage { border: 1px solid var(--dbs-border-default); }'),
    ).toEqual([]);
    expect(
      findBorderProblems(file, '.faqItem { border: 1px solid var(--dbs-border-default); }'),
    ).toHaveLength(1);
    expect(
      findBorderProblems(
        'src/other/styles.module.css',
        '.stage { border: 1px solid var(--dbs-border-default); }',
      ),
    ).toHaveLength(1);
  });

  it('flags a non-interactive border token on a control, naming the selector', () => {
    expect(
      findBorderProblems('src/x.css', '.field { border: 1px solid var(--dbs-border-default); }'),
    ).toEqual([{line: 1, rule: 'TOK-6', message: expect.stringContaining('--dbs-border-default')}]);
    expect(
      findBorderProblems(
        'src/x.css',
        ".tab[aria-disabled='true'] { border-color: var(--dbs-border-strong); }",
      ).map((p) => p.rule),
    ).toEqual(['TOK-6']);
  });

  it('flags each hairline token, in shorthands and logical properties', () => {
    for (const token of [
      '--dbs-border-default',
      '--dbs-border-strong',
      '--dbs-border-warm',
      '--dbs-border-warm-strong',
    ]) {
      expect(
        findBorderProblems('src/x.css', `.a { border-block-end: 1px solid var(${token}); }`).map(
          (p) => p.rule,
        ),
      ).toEqual(['TOK-6']);
    }
  });

  it('leaves control tokens, radii and non-border properties alone', () => {
    const css = [
      '.a { border: 1px solid var(--dbs-border-interactive); }',
      '.b { border: 2px solid var(--dbs-border-selected); }',
      '.c { border-radius: var(--dbs-radius-md); }',
      '.d { background: linear-gradient(var(--dbs-border-default), var(--dbs-border-default)); }',
      '.e { color: var(--dbs-border-default); }',
    ].join('\n');
    expect(findBorderProblems('src/x.css', css)).toEqual([]);
  });

  it.each([
    [
      'static card default, outranked for interactive kinds',
      '.card',
      'border: 1px solid var(--dbs-border-default)',
    ],
    [
      'empty placeholder',
      ".card[data-status='empty']",
      'border: 1px dashed var(--dbs-border-strong)',
    ],
    ['static KeyCap text', '.cap', 'border: 1px solid var(--dbs-border-strong)'],
    ['empty-state wrapper', '.framed', 'border: 1px dashed var(--dbs-border-strong)'],
    [
      'tablist rule, not a tab',
      ".tabs[data-appearance='underline'] .list",
      'border-block-end: 1px solid var(--dbs-border-default)',
    ],
    ['navbar hairline', '.navbar', 'border-block-end: 1px solid var(--dbs-border-default)'],
    [
      'drawer container rule',
      '.drawer:not([hidden])',
      'border-block-start: 1px solid var(--dbs-border-default)',
    ],
  ])('allows the decorative hairline: %s', (_why, selector, declaration) => {
    const module =
      selector === '.card' || selector.includes('data-status')
        ? 'Card'
        : selector === '.cap'
          ? 'KeyCap'
          : selector === '.framed'
            ? 'shared'
            : selector.includes('.list')
              ? 'Tabs'
              : 'Navbar';
    expect(
      findBorderProblems(
        `src/components/${module}/${module === 'shared' ? 'shared.module.css' : 'styles.module.css'}`,
        `${selector} { ${declaration}; }`,
      ),
    ).toEqual([]);
  });

  it.each([
    ['src/components/Navbar/styles.module.css', '.drawerActions,\n.drawerPreferences'],
    ['src/theme/DocLayout/styles.module.css', '.panel'],
    ['src/landing/styles.module.css', '.stage'],
    ['src/survey-results/styles.module.css', '.bar'],
  ])('keeps the integration hairline allowance scoped to %s', (file, selector) => {
    const css = `${selector} { border: 1px solid var(--dbs-border-default); }`;
    expect(findBorderProblems(file, css)).toEqual([]);
    expect(findBorderProblems('src/unrelated.css', css)).toHaveLength(1);
    expect(
      findBorderProblems(file, '.control { border: 1px solid var(--dbs-border-default); }'),
    ).toHaveLength(1);
  });

  it('does not mistake .tabs for .tab when classifying the tablist rule', () => {
    expect(
      isDecorativeBorder(
        'src/components/Tabs/styles.module.css',
        ".tabs[data-appearance='underline'] .list",
      ),
    ).toMatch(/tablist/);
    expect(
      findBorderProblems(
        'src/x.css',
        ".tabs[data-appearance='underline'] .tab { border-color: var(--dbs-border-default); }",
      ),
    ).toHaveLength(1);
  });

  it('still flags a control buried in a selector list or under @media', () => {
    expect(
      findBorderProblems(
        'src/x.css',
        '@media (max-width: 767px) { .field, .other { border-color: var(--dbs-border-warm); } }',
      ).map((p) => p.rule),
    ).toEqual(['TOK-6']);
  });

  it('ignores commented-out code', () => {
    expect(
      findBorderProblems(
        'src/x.css',
        '/* .field { border: 1px solid var(--dbs-border-default); } */',
      ),
    ).toEqual([]);
  });

  it('catches a violation over a tree and reports it from main', async () => {
    await write(
      'src/controls/field.css',
      '.field { border: 1px solid var(--dbs-border-default); }',
    );
    await write(
      'src/css/custom.css',
      '.menu__link--active { color: var(--dbs-accent-primary-text); }',
    );
    const violations = await findViolations(root);
    expect(violations.map((v) => `${v.file}:${v.line} ${v.rule}`)).toEqual([
      'src/controls/field.css:1 TOK-6',
    ]);
    const {lines, out} = recorder();
    expect(await main({root, out})).toBe(1);
    expect(lines.join('\n')).toMatch(/field\.css:1 {2}TOK-6/);
  });
});

describe('NAV-5: the active sidebar label binds accent.primary-text (B35)', () => {
  const BINDING = '.menu__link--active { color: var(--dbs-accent-primary-text); }';

  it('accepts the binding, including under hover', () => {
    expect(findNavProblems('src/css/custom.css', BINDING)).toEqual([]);
    expect(
      findNavProblems(
        'src/css/custom.css',
        '.menu__link--active:hover { color: var(--dbs-accent-primary-text); }',
      ),
    ).toEqual([]);
    expect(hasSidebarBinding([BINDING])).toBe(true);
  });

  it('flags any other colour on the active sidebar label', () => {
    const problems = findNavProblems(
      'src/css/custom.css',
      '.menu__link--active { color: var(--dbs-accent-primary); }',
    );
    expect(problems.map((p) => p.rule)).toEqual(['NAV-5']);
    expect(problems[0].message).toMatch(/accent-primary-text/);
  });

  it('fails the tree without the binding', async () => {
    await write('src/css/custom.css', 'a { color: red; }');
    expect(hasSidebarBinding(['a { color: red; }'])).toBe(false);
    const {lines, out} = recorder();
    expect(await main({root, out})).toBe(1);
    expect(lines.join('\n')).toMatch(/\(stylesheets\) {2}menu__link--active {2}NAV-5/);
  });

  it('passes the tree with the binding', async () => {
    await write('src/css/custom.css', BINDING);
    const {lines, out} = recorder();
    expect(await main({root, out})).toBe(0);
    expect(lines.join('\n')).toMatch(/TOK-6.*NAV-5 hold/);
  });
});

describe('B03 gaps closed in review', () => {
  it.each([
    "const s = {border: '1px solid #30363d'};",
    'const c = "rgba(0, 0, 0, 0.5)";',
    'const g = `linear-gradient(#0f1117cc, hsl(200 50% 50%))`;',
  ])('TOK-1 flags a colour inside a longer string: %s', (code) => {
    expect(findCodeProblems('src/components/x.tsx', code).map((p) => p.rule)).toEqual(['TOK-1']);
  });

  it.each(['<a href="#add">Add</a>', '<Link to="#bead">x</Link>', '[Jump](#bead)'])(
    'TOK-1 leaves an anchor alone: %s',
    (code) => {
      expect(findCodeProblems('src/pages/x.mdx', code)).toEqual([]);
    },
  );

  it.each(["color: '#FFF'", "fill: '#0f1117'", 'style={{color: "#0F1117CC"}}'])(
    'TOK-1 still flags a bare hex colour value: %s',
    (code) => {
      expect(findCodeProblems('src/components/x.tsx', code).map((p) => p.rule)).toEqual(['TOK-1']);
    },
  );

  it('treats a case-only difference as a no-op override', () => {
    const problems = findOverrideProblems({
      base: {text: {primary: '#ffffff'}},
      cream: {text: {primary: '#FFFFFF'}},
    });
    expect(problems).toEqual([expect.objectContaining({rule: 'TOK-12', name: 'text.primary'})]);
  });

  it('names the rule each override problem breaks', () => {
    const problems = findOverrideProblems({
      base: {text: {primary: '#ffffff'}},
      dark: {text: {primary: '#ffffff', ghost: '#000000'}},
    });
    expect(problems.map((p) => [p.name, p.rule])).toEqual([
      ['text.primary', 'TOK-12'],
      ['text.ghost', 'THM-4'],
    ]);
  });

  it('reports each override problem under its own rule', async () => {
    await write(
      SOURCE,
      JSON.stringify({...SOURCE_OK, cream: {surface: {base: '#ffffff', ghost: '#000000'}}}),
    );
    const {lines, out} = recorder();
    expect(await main({root, out})).toBe(1);
    expect(lines.join('\n')).toContain('cream.surface.base  TOK-12');
    expect(lines.join('\n')).toContain('cream.surface.ghost  THM-4');
  });
});

describe('B35 review regressions', () => {
  it.each([
    ['src/x.css', '.card'],
    ['src/components/Navbar/styles.module.css', '.drawer button'],
    ['src/components/Tabs/styles.module.css', '.list button'],
    ['src/components/Card/styles.module.css', ".card[data-status='empty'], .field"],
  ])('does not grant decorative exceptions to %s %s', (file, selector) => {
    expect(
      findBorderProblems(file, `${selector} { border: 1px solid var(--dbs-border-default); }`),
    ).toHaveLength(1);
  });

  it('keeps the containing rule after a nested rule closes', () => {
    const css =
      '.field { &:hover { color: var(--dbs-text-primary); } border: 1px solid var(--dbs-border-default); }';
    expect(findBorderProblems('src/x.css', css)[0]?.message).toContain("'.field'");
  });

  it.each([
    '@media (min-width: 1px) { .menu__link--active { color: var(--dbs-accent-primary); } }',
    '.menu__link--active { @media (min-width: 1px) { color: var(--dbs-accent-primary); } }',
    '.menu__link--active { &:hover { color: var(--dbs-accent-primary); } }',
  ])('checks the active label in nested CSS: %s', (css) => {
    expect(findNavProblems('src/x.css', css)).toHaveLength(1);
  });

  it('accepts a nested binding and reports its actual declaration line', () => {
    expect(
      hasSidebarBinding([
        '@media (min-width: 1px) { .menu__link--active { color: var(--dbs-accent-primary-text); } }',
      ]),
    ).toBe(true);
    expect(
      findNavProblems(
        'src/x.css',
        '@media (x:y) {\n.menu__link--active {\ncolor: var(--dbs-accent-primary);\n}\n}',
      )[0]?.line,
    ).toBe(3);
  });

  it.each([
    '.menu__link--active-shadow { color: var(--dbs-accent-primary-text); }',
    '.menu__link--active::before { color: var(--dbs-accent-primary-text); }',
    '.menu__link--active:hover { color: var(--dbs-accent-primary-text); }',
    '.other:not(.x, .menu__link--active) { color: var(--dbs-accent-primary-text); }',
    '.other[data-label=".menu__link--active"] { color: var(--dbs-accent-primary-text); }',
  ])('does not satisfy the at-rest label binding with %s', (css) => {
    expect(hasSidebarBinding([css])).toBe(false);
  });
});

describe('generated browser artifacts', () => {
  it('does not lint or satisfy the sidebar binding from a recorded trace', async () => {
    await write('src/css/custom.css', 'a { text-decoration: underline; }');
    await write(
      'test-results/traces/resources/bundle.css',
      '.field {border: 1px solid var(--dbs-border-default);} .menu__link--active { color: var(--dbs-accent-primary-text); }',
    );
    expect(await findViolations(root)).toEqual([]);
    expect(await main({root, out: recorder().out})).toBe(1);
  });
});
