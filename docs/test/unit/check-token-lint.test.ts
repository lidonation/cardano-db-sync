import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {afterEach, beforeEach, describe, expect, it} from 'vitest';

import {
  RETIRED_TOKENS,
  SOURCE,
  TOKENS_CSS,
  findCodeProblems,
  findOverrideProblems,
  findViolations,
  flatten,
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
      {line: 1, rule: 'TOK-1', message: "hex colour '#0f1117' - use a --dbs-* token"},
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
    expect(lines.join('\n')).toMatch(/dark\.surface\.base {2}THM-4 {2}no-op override/);
    expect(lines.join('\n')).toMatch(/src\/a\.tsx:1 {2}TOK-1/);
  });

  it('cannot run, rather than passing, without the token source', async () => {
    await fs.rm(path.join(root, SOURCE));
    const {lines, out} = recorder();
    expect(await main({root, out})).toBe(2);
    expect(lines.join('\n')).toMatch(/cannot read/);
  });
});
