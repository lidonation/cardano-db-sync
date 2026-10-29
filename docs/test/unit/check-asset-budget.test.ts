import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {afterEach, beforeEach, describe, expect, it} from 'vitest';

import {
  gzipSize,
  initialAssets,
  kindOf,
  localeSites,
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
      expect(pages).toEqual([
        {
          page: 'index.html',
          bytes: size(html(base)) + size(css) + size(js),
          htmlBytes: size(html(base)),
        },
      ]);
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

describe('each locale is its own site', () => {
  const page = '<script src="/assets/a.js"></script>';

  beforeEach(async () => {
    await write('index.html', page);
    await write('assets/a.js', 'a'.repeat(4000));
    for (const locale of ['ja', 'de']) {
      await write(`${locale}/index.html`, page);
      await write(`${locale}/assets/a.js`, 'b'.repeat(4000));
    }
    // A plain content directory with an assets folder but no home page is not a site.
    await write('docs/assets/x.png', 'x');
    await write('docs/index.html', page);
    await fs.rm(path.join(root, 'docs', 'index.html'));
    await write('docs/intro/index.html', page);
  });

  it('finds the locale directories that are whole sites', async () => {
    expect(await localeSites(root)).toEqual([path.join(root, 'de'), path.join(root, 'ja')]);
  });

  it('measures the default locale without the others', async () => {
    const all = await measure(root);
    const own = await measure(root, await localeSites(root));
    expect(own.totals.js).toBe(size('a'.repeat(4000)));
    expect(all.totals.js).toBe(own.totals.js + 2 * size('b'.repeat(4000)));
  });

  it('holds every locale to the budget separately', async () => {
    const lines: string[] = [];
    const out = {log: (m: string) => lines.push(m), error: (m: string) => lines.push(m)};
    const limit = size('a'.repeat(4000)) + 10;
    expect(await main([root], out, {totals: {js: limit}})).toBe(0);
    expect(lines.filter((l) => l.startsWith('check:budget - '))).toHaveLength(4);
    expect(lines.join('\n')).toMatch(/\/ja \(gzip\)/);
  });
});

describe('complete site asset policy', () => {
  it('enforces all five asset totals and retains the initial-page gate', async () => {
    const budget = parseBudget(
      JSON.parse(
        await fs.readFile(path.join(import.meta.dirname, '../../config/asset-budget.json'), 'utf8'),
      ),
    );
    expect(Object.keys(budget.totals!).sort()).toEqual(['css', 'font', 'html', 'image', 'js']);
    expect(budget.page?.initial).toBe(180 * 1024);
    for (const kind of ['js', 'css', 'font', 'image', 'html'] as const) {
      const cap = budget.totals![kind]!;
      expect(overBudget({totals: {[kind]: cap}, pages: []}, budget)).toEqual([]);
      expect(overBudget({totals: {[kind]: cap + 1}, pages: []}, budget)).toEqual([
        {what: `total ${kind}`, bytes: cap + 1, limit: cap},
      ]);
    }
  });
  it.each(['font', 'image', 'html'] as const)(
    'fails the real CLI gate for an oversized %s file in a non-default locale',
    async (kind) => {
      await write('index.html', '<p>default</p>');
      await write('ja/index.html', '<p>locale</p>');
      await write('ja/assets/main.js', 'x');
      const file = {font: 'font.woff2', image: 'image.webp', html: 'page.html'}[kind];
      await write(`ja/assets/${file}`, 'payload');
      const lines: string[] = [];
      expect(
        await main(
          [root],
          {log: (m) => lines.push(m), error: (m) => lines.push(m)},
          {totals: {[kind]: 1}},
        ),
      ).toBe(1);
      expect(lines.join('\n')).toContain(`over budget: total ${kind}`);
    },
  );
});

describe('per-page HTML budget', () => {
  it('accepts exactly 20 KiB and rejects one byte over independently of initial assets', () => {
    const limit = 20 * 1024;
    expect(
      overBudget(
        {totals: {}, pages: [{page: 'a.html', bytes: limit, htmlBytes: limit}]},
        {page: {html: limit, initial: 180 * 1024}},
      ),
    ).toEqual([]);
    expect(
      overBudget(
        {totals: {}, pages: [{page: 'a.html', bytes: limit + 1, htmlBytes: limit + 1}]},
        {page: {html: limit, initial: 180 * 1024}},
      ),
    ).toEqual([{what: 'HTML of a.html', bytes: limit + 1, limit}]);
  });
  it('still rejects combined payloads when HTML is small', () => {
    expect(
      overBudget(
        {totals: {}, pages: [{page: 'a.html', bytes: 184321, htmlBytes: 100}]},
        {page: {html: 20480, initial: 184320}},
      ),
    ).toEqual([{what: 'initial payload of a.html', bytes: 184321, limit: 184320}]);
  });
  it('fails closed if the HTML measurement is missing', () => {
    expect(() =>
      overBudget({totals: {}, pages: [{page: 'a.html', bytes: 100}]}, {page: {html: 20480}}),
    ).toThrow('missing HTML measurement');
  });
  it('detects oversized HTML in a non-default locale through the CLI', async () => {
    await write('index.html', '<p>default</p>');
    await write('ja/index.html', '<p>locale</p>');
    await write('ja/assets/main.js', 'x');
    const lines: string[] = [];
    expect(
      await main(
        [root],
        {log: (m) => lines.push(m), error: (m) => lines.push(m)},
        {page: {html: 1}},
      ),
    ).toBe(1);
    expect(lines.join('\n')).toContain('over budget: HTML of index.html');
  });
  it('ships the approved 20 KiB HTML and 180 KiB combined limits', async () => {
    const budget = parseBudget(
      JSON.parse(
        await fs.readFile(path.join(import.meta.dirname, '../../config/asset-budget.json'), 'utf8'),
      ),
    );
    expect(budget.page).toEqual({html: 20480, initial: 184320});
  });
});
