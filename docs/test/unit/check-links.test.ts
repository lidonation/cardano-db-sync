import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {afterEach, beforeEach, describe, expect, it} from 'vitest';

import {findBrokenLinks, main, siteRoot} from '../../scripts/check-links.mjs';

const ORIGIN = 'https://example.test';

let root: string;

/** Write a minimal build output served at `base`, with the given files. */
async function site(base: string, files: Record<string, string>) {
  const locs = ['', 'docs/intro'].map((p) => `<url><loc>${ORIGIN}${base}${p}</loc></url>`).join('');
  await fs.writeFile(path.join(root, 'sitemap.xml'), `<urlset>${locs}</urlset>`);
  for (const [rel, contents] of Object.entries(files)) {
    const full = path.join(root, rel);
    await fs.mkdir(path.dirname(full), {recursive: true});
    await fs.writeFile(full, contents);
  }
}

const page = (body: string) => `<!doctype html><html><body>${body}</body></html>`;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'dbsync-links-'));
});

afterEach(async () => {
  await fs.rm(root, {recursive: true, force: true});
});

describe('siteRoot', () => {
  it('reads origin and base path from the shortest sitemap entry', async () => {
    await site('/sub/', {});
    expect(await siteRoot(root)).toEqual({origin: ORIGIN, base: '/sub/'});
  });

  it('fails loudly on an empty sitemap', async () => {
    await fs.writeFile(path.join(root, 'sitemap.xml'), '<urlset></urlset>');
    await expect(siteRoot(root)).rejects.toThrow('lists no pages');
  });
});

describe('check:links (BLD-3)', () => {
  it.each(['/', '/sub/'])('accepts resolving links under base %s', async (base) => {
    await site(base, {
      'index.html': page(
        `<a href="${base}docs/intro">a</a><a href="docs/intro/">b</a>` +
          `<link rel="stylesheet" href="${base}assets/s.css"><a href="#top" id="top">t</a>` +
          `<a href="${base}docs/intro#install">c</a><a href="${ORIGIN}${base}">d</a>`,
      ),
      'docs/intro/index.html': page('<h2 id="install">x</h2><a href="../../">home</a>'),
      'assets/s.css': 'body{}',
    });
    expect(await findBrokenLinks(root)).toEqual([]);
  });

  it('flags a link to a page that does not exist', async () => {
    await site('/', {'index.html': page('\n<a href="/docs/missing">x</a>')});
    const violations = await findBrokenLinks(root);
    expect(violations).toEqual([
      {
        file: 'index.html',
        line: 2,
        url: '/docs/missing',
        message: 'no file in the build serves this path',
      },
    ]);
  });

  it('flags a missing static asset', async () => {
    await site('/', {'index.html': page('<img src="/img/logo.svg">')});
    expect((await findBrokenLinks(root)).map((v) => v.url)).toEqual(['/img/logo.svg']);
  });

  it('flags a fragment the target page lacks', async () => {
    await site('/', {
      'index.html': page('<a href="/docs/intro#nope">x</a><a href="#gone">y</a>'),
      'docs/intro/index.html': page('<h2 id="yes">x</h2>'),
    });
    const messages = (await findBrokenLinks(root)).map((v) => v.message);
    expect(messages).toEqual([
      'no element with id "nope" on the target page',
      'no element with id "gone" on the target page',
    ]);
  });

  it('flags a root-relative link that escapes the base path', async () => {
    await site('/sub/', {'index.html': page('<a href="/docs/intro">x</a>')});
    expect((await findBrokenLinks(root))[0].message).toContain('outside the site base path /sub/');
  });

  it('flags a malformed URL', async () => {
    await site('/', {'index.html': page('<a href="http://[bad">x</a>')});
    expect((await findBrokenLinks(root))[0].message).toBe('malformed');
  });

  it('ignores external links and non-document schemes', async () => {
    await site('/', {
      'index.html': page(
        '<a href="https://github.com/x/y/missing">g</a><a href="mailto:a@b.c">m</a>' +
          '<a href="javascript:void(0)">j</a><img src="data:image/png;base64,AA=="><a href="">e</a>',
      ),
    });
    expect(await findBrokenLinks(root)).toEqual([]);
  });

  it('resolves extensionless routes to a sibling .html file and decodes entities', async () => {
    await site('/', {
      'index.html': page('<a href="/about?a=1&amp;b=2">x</a>'),
      'about.html': page(''),
    });
    expect(await findBrokenLinks(root)).toEqual([]);
  });
});

describe('check:links CLI reporting', () => {
  function recorder() {
    const lines: string[] = [];
    return {
      lines,
      log: (msg: string) => lines.push(msg),
      error: (msg: string) => lines.push(msg),
    };
  }

  it('exits 0 on a clean build', async () => {
    await site('/', {'index.html': page('<a href="/">x</a>')});
    const out = recorder();
    expect(await main([root], out)).toBe(0);
    expect(out.lines.join('\n')).toContain('clean');
  });

  it('exits 1 naming the page, line and URL', async () => {
    await site('/', {'index.html': page('<a href="/nowhere">x</a>')});
    const out = recorder();
    expect(await main([root], out)).toBe(1);
    const report = out.lines.join('\n');
    expect(report).toContain('1 broken link(s)');
    expect(report).toContain('index.html:1  /nowhere');
  });
});
