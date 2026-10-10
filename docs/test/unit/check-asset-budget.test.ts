import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {afterEach, beforeEach, describe, expect, it} from 'vitest';

import {
  gzipSize,
  initialAssets,
  kindOf,
  main,
  measure,
  overBudget,
  parseBudget,
} from '../../scripts/check-asset-budget.mjs';

let root: string;

async function write(rel: string, contents: string | Buffer) {
  const full = path.join(root, rel);
  await fs.mkdir(path.dirname(full), {recursive: true});
  await fs.writeFile(full, contents);
}

const size = (s: string) => gzipSize(Buffer.from(s));

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'dbsync-budget-'));
});

afterEach(async () => {
  await fs.rm(root, {recursive: true, force: true});
});

describe('kindOf', () => {
  it.each([
    ['a/b.js', 'js'],
    ['s.CSS', 'css'],
    ['i.html', 'html'],
    ['logo.svg', 'image'],
    ['f.woff2', 'font'],
    ['CNAME', 'other'],
  ])('%s is %s', (file, kind) => {
    expect(kindOf(file)).toBe(kind);
  });
});

describe('measure', () => {
  const html = (base: string) =>
    `<link rel="stylesheet" href="${base}assets/s.css">` +
    `<script src="${base}assets/a.js" defer></script><script src="${base}assets/a.js"></script>` +
    '<script src="https://cdn.example/x.js"></script><script>inline()</script>';
  const css = 'body{color:red}'.repeat(20);
  const js = 'console.log(1);'.repeat(40);

  it.each(['/', '/sub/'])(
    'totals by kind and counts each page asset once, under base %s',
    async (base) => {
      await write('index.html', html(base));
      await write('assets/s.css', css);
      await write('assets/a.js', js);
      await write('assets/unused.js', 'x');

      const {totals, pages} = await measure(root);
      expect(totals).toEqual({
        html: size(html(base)),
        css: size(css),
        js: size(js) + size('x'),
      });
      expect(pages).toEqual([{page: 'index.html', bytes: size(html(base)) + size(css) + size(js)}]);
    },
  );

  it('orders pages heaviest first', async () => {
    await write('light.html', '<p>hi</p>');
    await write('heavy.html', '<script src="/big.js"></script>');
    await write('big.js', 'y'.repeat(10_000) + Math.random());
    expect((await measure(root)).pages.map((p) => p.page)).toEqual(['heavy.html', 'light.html']);
  });
});

describe('overBudget', () => {
  const measured = {
    totals: {js: 2000, css: 100},
    pages: [
      {page: 'a.html', bytes: 900},
      {page: 'b.html', bytes: 400},
    ],
  };

  it('is empty when every limit holds', () => {
    expect(
      overBudget(measured, {totals: {js: 2000, css: 100, font: 0}, page: {initial: 900}}),
    ).toEqual([]);
  });

  it('names each exceeded total and page', () => {
    expect(overBudget(measured, {totals: {js: 1999}, page: {initial: 500}})).toEqual([
      {what: 'total js', bytes: 2000, limit: 1999},
      {what: 'initial payload of a.html', bytes: 900, limit: 500},
    ]);
  });

  it('limits nothing the budget does not name', () => {
    expect(overBudget(measured, {})).toEqual([]);
  });
});

describe('check:budget CLI reporting', () => {
  function recorder() {
    const lines: string[] = [];
    return {
      lines,
      log: (msg: string) => lines.push(msg),
      error: (msg: string) => lines.push(msg),
    };
  }

  beforeEach(async () => {
    await write('index.html', '<script src="/a.js"></script>');
    await write('a.js', 'z'.repeat(5000) + 'q'.repeat(3000));
  });

  it('exits 0 and reports the measurement when within budget', async () => {
    const out = recorder();
    expect(await main([root], out, {totals: {js: 100_000}, page: {initial: 100_000}})).toBe(0);
    const report = out.lines.join('\n');
    expect(report).toContain('heaviest page: index.html');
    expect(report).toContain('within budget');
  });

  it('exits 1 and names what is over', async () => {
    const out = recorder();
    expect(await main([root], out, {totals: {js: 1}})).toBe(1);
    const report = out.lines.join('\n');
    expect(report).toContain('over budget: total js');
    expect(report).toContain('config/asset-budget.json');
  });
});

describe('initialAssets', () => {
  it('reads stylesheet links and script sources whatever the attribute order', () => {
    const html =
      '<link href="/a.css" rel="stylesheet"><link rel=stylesheet href=/b.css>' +
      '<link rel="preload stylesheet" href="/c.css"><link rel="preload" href="/d.js">' +
      '<script defer src="/e.js"></script><script>inline()</script>';
    expect(initialAssets(html)).toEqual(['/a.css', '/b.css', '/c.css', '/e.js']);
  });
});

describe('parseBudget', () => {
  it('accepts the budget the repo ships', async () => {
    const shipped = JSON.parse(
      await fs.readFile(path.join(import.meta.dirname, '../../config/asset-budget.json'), 'utf8'),
    );
    expect(parseBudget(shipped)).toEqual(shipped);
  });

  it.each([
    [{totals: {javascript: 1}}, 'totals.javascript is not a kind'],
    [{totals: {js: '190000'}}, 'totals.js must be a positive number'],
    [{page: {initial: 0}}, 'page.initial must be a positive number'],
    [{page: {first: 1}}, 'page.first is not a page limit'],
    [{total: {js: 1}}, 'unknown key "total"'],
  ])('rejects %j', (budget, message) => {
    expect(() => parseBudget(budget)).toThrow(message);
  });

  it('makes the CLI fail on a misspelt kind instead of limiting nothing', async () => {
    await write('index.html', '<p>x</p>');
    await expect(
      main([root], {log: () => {}, error: () => {}}, {totals: {jss: 1}}),
    ).rejects.toThrow('not a kind');
  });
});
