import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {afterEach, beforeEach, describe, expect, it} from 'vitest';

import {
  findPageViolations,
  findStylesheetViolations,
  hashSource,
  main,
  policyProblems,
} from '../../scripts/check-csp.mjs';
import {STRICT_DIRECTIVES, cspMetaTag, policyFor, serializePolicy} from '../../plugins/security';

const STRICT = cspMetaTag(STRICT_DIRECTIVES);
const SCRIPT = 'document.documentElement.setAttribute("data-theme","light")';
const WITH_HASH = cspMetaTag(policyFor('/', {scriptHashes: [hashSource(SCRIPT)]}));

const page = (meta: string, head = '', body = '') =>
  `<html><head><meta charset="utf-8">${meta}${head}</head><body>${body}</body></html>`;

const rules = (file: string, html: string) =>
  findPageViolations(file, html).map(
    (v: {rule: string; message: string}) => `${v.rule} ${v.message}`,
  );

describe('the policy in each page', () => {
  it('passes the plugin output, hashes included', () => {
    expect(rules('index.html', page(WITH_HASH, `<script>${SCRIPT}</script>`))).toEqual([]);
  });

  it('needs exactly one policy, ahead of every load', () => {
    expect(rules('a.html', page(''))).toEqual([
      'SEC-1 0 Content-Security-Policy meta tags, expected exactly 1',
    ]);
    expect(rules('a.html', page(STRICT + STRICT))[0]).toMatch(/2 Content-Security-Policy/);
    const late = '<html><head><script src="/a.js"></script>' + STRICT + '</head></html>';
    expect(rules('a.html', late)).toEqual([
      'SEC-1 a script, stylesheet or style comes before the policy',
    ]);
  });

  it.each([
    ["script-src 'self' 'unsafe-inline'", /script-src allows 'unsafe-inline'/],
    ["script-src 'self' https://cdn.example", /script-src allows https:\/\/cdn.example/],
    ["style-src 'self' 'unsafe-inline'", /style-src is "'self' 'unsafe-inline'"/],
    ["font-src 'self' data:", /font-src is "'self' data:"/],
    ["frame-ancestors 'none'", /unexpected directive frame-ancestors/],
  ])('flags a loosened or meta-ignored policy: %s', (change, message) => {
    const [name] = change.split(' ');
    const base = Object.entries(STRICT_DIRECTIVES).filter(([n]) => n !== name);
    const policy = [...base.map(([n, s]) => `${n} ${s.join(' ')}`), change].join('; ');
    expect(policyProblems(policy, 'docs/a.html').join('\n')).toMatch(message);
  });

  it('flags a missing directive, and script-src without its self', () => {
    expect(policyProblems("default-src 'self';", 'a.html')).toContain('missing base-uri (SEC-2)');
    const policy = serializePolicy({...STRICT_DIRECTIVES, 'script-src': ["'sha256-abc='"]});
    expect(policyProblems(policy, 'a.html')).toEqual(["script-src must start with 'self' (SEC-2)"]);
  });

  it('allows extension schemes on the survey route only (SEC-8)', () => {
    const relaxed = serializePolicy(
      policyFor('/survey', {surveyRelaxation: ['chrome-extension:']}),
    );
    expect(policyProblems(relaxed, 'survey/index.html')).toEqual([]);
    expect(policyProblems(relaxed, 'docs/index.html')).toEqual([
      'script-src allows chrome-extension: (SEC-2, SEC-8)',
    ]);
  });
});

describe('what each page does', () => {
  it('flags an inline script the policy does not hash (SEC-3)', () => {
    expect(rules('a.html', page(STRICT, '<script>track()</script>'))).toEqual([
      'SEC-3 inline script not covered by a hash in script-src: track()',
    ]);
  });

  it('ignores data blocks and external scripts', () => {
    const head = '<script type="application/ld+json">{}</script><script src="/a.js"></script>';
    expect(rules('a.html', page(STRICT, head))).toEqual([]);
  });

  it('flags inline styles', () => {
    expect(
      rules('a.html', page(STRICT, '<style>p{}</style>', '<p style="color:red">x</p>')),
    ).toHaveLength(2);
  });

  it('flags loads from another origin, not links people follow', () => {
    const head =
      '<link rel="stylesheet" href="https://fonts.googleapis.com/css2">' +
      '<link rel="canonical" href="https://dbsync.cardano.intersect.org/">';
    const body =
      '<a href="https://github.com/IntersectMBO/cardano-db-sync">GitHub</a>' +
      '<img src="//cdn.example/a.png"><img srcset="/a.png 1x, https://cdn.example/b.png 2x">';
    expect(rules('a.html', page(STRICT, head, body))).toEqual([
      'SEC-2 <link href> loads from another origin: https://fonts.googleapis.com/css2',
      'SEC-2 <img src> loads from another origin: //cdn.example/a.png',
      'SEC-2 <img srcset> loads from another origin: https://cdn.example/b.png',
    ]);
  });
});

describe('stylesheets', () => {
  it('flags external url() and @import, and inlined fonts', () => {
    const css =
      '@import "https://fonts.googleapis.com/css2";\n' +
      '@font-face{src:url(https://cdn.example/f.woff2)}\n' +
      '@font-face{src:url(data:font/woff2;base64,AAAA)}\n' +
      'a{background:url(data:image/svg+xml;utf8,<svg/>)}\n' +
      '@font-face{src:url(/assets/fonts/f.woff2)}';
    expect(
      findStylesheetViolations('a.css', css).map(
        (v: {line: number; message: string}) => `${v.line} ${v.message}`,
      ),
    ).toEqual([
      '1 loads from another origin: https://fonts.googleapis.com/css2',
      '2 loads from another origin: https://cdn.example/f.woff2',
      "3 a data: font, which font-src 'self' refuses",
    ]);
  });
});

describe('check:csp over a build', () => {
  let buildRoot: string;
  let dir: string;
  const lines: string[] = [];
  const out = {log: (m: string) => lines.push(m), error: (m: string) => lines.push(m)};

  beforeEach(async () => {
    buildRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'dbsync-csp-'));
    dir = path.join(buildRoot, 'dev');
    lines.length = 0;
    await fs.mkdir(path.join(dir, 'assets'), {recursive: true});
    await fs.writeFile(path.join(dir, 'index.html'), page(WITH_HASH, `<script>${SCRIPT}</script>`));
    await fs.writeFile(path.join(dir, 'assets', 'a.css'), 'a{}');
  });

  afterEach(async () => {
    await fs.rm(buildRoot, {recursive: true, force: true});
  });

  it('exits 0 on a clean build', async () => {
    expect(await main([dir], out)).toBe(0);
    expect(lines.join('\n')).toMatch(/clean/);
  });

  it('exits 1 naming file, line and rule', async () => {
    await fs.writeFile(path.join(dir, 'assets', 'a.css'), '\n@import "https://x.example/a.css";');
    expect(await main([dir], out)).toBe(1);
    expect(lines.join('\n')).toMatch(/assets\/a\.css:2 {2}SEC-2 {2}loads from another origin/);
  });

  it('checks every profile under build/ by default, and says when there is none', async () => {
    expect(await main([], out, buildRoot)).toBe(0);
    const empty = await fs.mkdtemp(path.join(os.tmpdir(), 'dbsync-csp-empty-'));
    try {
      expect(await main([], out, empty)).toBe(1);
      expect(lines.join('\n')).toMatch(/no build output found/);
    } finally {
      await fs.rm(empty, {recursive: true, force: true});
    }
  });

  it('fails on a directory with no pages, and on no build at all', async () => {
    await fs.rm(path.join(dir, 'index.html'));
    expect(await main([dir], out)).toBe(1);
    expect(lines.join('\n')).toMatch(/no HTML pages/);
    expect(await main([path.join(dir, 'missing')], out)).toBe(1);
  });
});
