import {execFile} from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {promisify} from 'node:util';

import {afterEach, beforeEach, describe, expect, it} from 'vitest';

import {GENERATOR, OUTPUT, SOURCE, firstDifferences, main} from '../../scripts/check-tokens.mjs';

const DOCS_ROOT = path.resolve(import.meta.dirname, '../..');
const run = promisify(execFile);

let root: string;

function recorder() {
  const lines: string[] = [];
  return {lines, out: {log: (m: string) => lines.push(m), error: (m: string) => lines.push(m)}};
}

/** A docs root holding the real generator and a token source. */
async function tree(source: unknown): Promise<void> {
  await fs.mkdir(path.join(root, 'design', 'tools'), {recursive: true});
  await fs.mkdir(path.join(root, 'src', 'css'), {recursive: true});
  await fs.copyFile(path.join(DOCS_ROOT, GENERATOR), path.join(root, GENERATOR));
  await fs.writeFile(path.join(root, SOURCE), JSON.stringify(source));
}

async function generate(): Promise<string> {
  const {stdout} = await run('python3', [GENERATOR, SOURCE], {cwd: root});
  return stdout;
}

const style = (
  family: string,
  size: number,
  weight: number,
  leading: number,
  tracking: string,
) => ({
  family,
  size,
  weight,
  leading,
  tracking,
});

const SOURCE_FIXTURE = {
  base: {
    surface: {base: '#ffffff'},
    typography: {
      family: {ui: 'Inter, sans-serif', code: 'monospace'},
      style: {
        body: style('ui', 15, 400, 1.65, '0'),
        'label-sm': style('ui', 12, 700, 1.2, '0.04em'),
        'mono-sm': style('code', 11.5, 400, 1.5, '0'),
      },
    },
  },
  dark: {surface: {base: '#0f1117'}},
};

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'dbsync-tokens-'));
});

afterEach(async () => {
  await fs.rm(root, {recursive: true, force: true});
});

describe('tokens-to-css typography (DF-1)', () => {
  it('emits each style as a font shorthand plus size, leading and tracking tokens', async () => {
    await tree(SOURCE_FIXTURE);
    const css = await generate();
    expect(css).toContain('  --dbs-font-ui: Inter, sans-serif;');
    expect(css).toContain('  --dbs-font-body: 400 15px/1.65 var(--dbs-font-ui);');
    expect(css).toContain('  --dbs-font-mono-sm: 400 11.5px/1.5 var(--dbs-font-code);');
    expect(css).toContain('  --dbs-font-label-sm-size: 12px;');
    expect(css).toContain('  --dbs-font-label-sm-leading: 1.2;');
    expect(css).toContain('  --dbs-font-label-sm-tracking: 0.04em;');
    expect(css).not.toMatch(/--dbs-typography/);
  });

  it('emits one class per style that sets the font and its tracking together', async () => {
    await tree(SOURCE_FIXTURE);
    const css = await generate();
    expect(css.match(/^\.dbs-type-[a-z-]+ \{$/gm)).toEqual([
      '.dbs-type-body {',
      '.dbs-type-label-sm {',
      '.dbs-type-mono-sm {',
    ]);
    expect(css).toContain(
      '.dbs-type-label-sm {\n  font: var(--dbs-font-label-sm);\n  letter-spacing: var(--dbs-font-label-sm-tracking);\n}',
    );
  });

  it('points Infima at the body and mono tokens instead of literal sizes', async () => {
    await tree(SOURCE_FIXTURE);
    const css = await generate();
    expect(css).toContain('--ifm-font-size-base: var(--dbs-font-body-size);');
    expect(css).toContain('--ifm-line-height-base: var(--dbs-font-body-leading);');
    expect(css).toContain('--ifm-code-font-size: var(--dbs-font-mono-size);');
  });

  it.each([
    [
      'a style missing a metric',
      {style: {body: {family: 'ui', size: 15, weight: 400, leading: 1.65}}},
      /'body' is missing tracking/,
    ],
    [
      'a style naming an unknown family',
      {style: {body: style('serif', 15, 400, 1.65, '0')}},
      /unknown family 'serif'/,
    ],
    ['a typography group with no styles', {style: {}}, /needs `family` and `style`/],
    [
      'a size that is not a number',
      {style: {body: {...style('ui', 15, 400, 1.65, '0'), size: '15px'}}},
      /size must be a positive number/,
    ],
    [
      'a zero leading',
      {style: {body: style('ui', 15, 400, 0, '0')}},
      /leading must be a positive number/,
    ],
    [
      'a weight outside 1-1000',
      {style: {body: style('ui', 15, 1200, 1.65, '0')}},
      /weight must be a whole number/,
    ],
    [
      'a unitless tracking, which a browser drops',
      {style: {body: {...style('ui', 15, 400, 1.65, '0'), tracking: -0.02}}},
      /tracking must be 0 or a length/,
    ],
    [
      'a tracking in an unsupported unit',
      {style: {body: style('ui', 15, 400, 1.65, '2%')}},
      /tracking must be 0 or a length/,
    ],
  ])('fails on %s', async (_label, typography, message) => {
    await tree({
      base: {typography: {family: {ui: 'Inter'}, ...typography}},
    });
    await expect(generate()).rejects.toThrow(message);
  });

  it('fails on a set that maps to no theme, instead of dropping it', async () => {
    await tree({...SOURCE_FIXTURE, 'high-contrast': {surface: {base: '#000000'}}});
    await expect(generate()).rejects.toThrow(/'high-contrast' maps to no theme selector/);
  });

  it('names the token source, not Penpot, as the origin in the header', async () => {
    await tree(SOURCE_FIXTURE);
    expect(await generate()).toMatch(/GENERATED from design\/tokens\.source\.json/);
  });

  it('fails when the base set has no typography, or a theme set carries one', async () => {
    await tree({base: {surface: {base: '#fff'}}});
    await expect(generate()).rejects.toThrow(/base set has no typography/);
    await tree({...SOURCE_FIXTURE, dark: {typography: SOURCE_FIXTURE.base.typography}});
    await expect(generate()).rejects.toThrow(/typography belongs to the base set only/);
  });
});

describe('firstDifferences', () => {
  it('reports differing lines, including a missing tail, up to the limit', () => {
    expect(firstDifferences('a\nb\nc', 'a\nB\nc\nd')).toEqual([
      {line: 2, committed: 'b', generated: 'B'},
      {line: 4, committed: '<end of file>', generated: 'd'},
    ]);
    expect(firstDifferences('1\n2\n3', 'x\ny\nz', 2)).toHaveLength(2);
    expect(firstDifferences('1\n2\n3', 'x\ny\nz')).toHaveLength(3);
  });
});

describe('check:tokens gate', () => {
  it('passes when tokens.css is a fresh run of the generator', async () => {
    await tree(SOURCE_FIXTURE);
    await fs.writeFile(path.join(root, OUTPUT), await generate());
    const {lines, out} = recorder();
    expect(await main({root, out})).toBe(0);
    expect(lines.join('\n')).toMatch(/regenerates byte-identically/);
  });

  it('fails on a hand edit, naming the line and both versions', async () => {
    await tree(SOURCE_FIXTURE);
    const fresh = await generate();
    await fs.writeFile(path.join(root, OUTPUT), fresh.replace('15px/1.65', '16px/1.65'));
    const {lines, out} = recorder();
    expect(await main({root, out})).toBe(1);
    expect(lines.join('\n')).toMatch(/committed: {3}--dbs-font-body: 400 16px\/1\.65/);
    expect(lines.join('\n')).toMatch(/generated: {3}--dbs-font-body: 400 15px\/1\.65/);
  });

  it('summarises the differing lines beyond the first five', async () => {
    await tree(SOURCE_FIXTURE);
    await fs.writeFile(path.join(root, OUTPUT), 'x\n'.repeat(8));
    const {lines, out} = recorder();
    expect(await main({root, out})).toBe(1);
    expect(lines.filter((l) => /^ {2}line \d+$/.test(l))).toHaveLength(5);
    expect(lines.join('\n')).toMatch(/\.\.\.and \d+ more differing line\(s\)/);
  });

  it('says tokens.css is missing rather than that the generator cannot run', async () => {
    await tree(SOURCE_FIXTURE);
    const {lines, out} = recorder();
    expect(await main({root, out})).toBe(1);
    expect(lines.join('\n')).toMatch(/src\/css\/tokens\.css is missing/);
  });

  it('cannot run, rather than passing, when the generator is unavailable', async () => {
    await tree(SOURCE_FIXTURE);
    await fs.writeFile(path.join(root, OUTPUT), '');
    const {lines, out} = recorder();
    expect(await main({root, out, python: 'no-such-python'})).toBe(2);
    expect(lines.join('\n')).toMatch(/cannot run the generator/);
  });
});
