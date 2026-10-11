import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {afterEach, beforeEach, describe, expect, it} from 'vitest';

import securityPlugin, {
  EXTENSION_SCHEMES,
  STRICT_DIRECTIVES,
  SURVEY_SCRIPT_RELAXATION,
  applyPolicies,
  applyPolicy,
  cspMetaTag,
  emitFontsAsFiles,
  hashSource,
  inlineScripts,
  isColourModeBootstrap,
  policyFor,
  routeFile,
  serializePolicy,
} from '../../plugins/security';
import type {LoadContext, Plugin} from '@docusaurus/types';

type Configuration = Parameters<NonNullable<Plugin['configureWebpack']>>[0];

const BOOTSTRAP =
  '!function(){var t=function(){try{return window.localStorage.getItem("theme")}catch(t){}}();' +
  'document.documentElement.setAttribute("data-theme",t||"light")}()';

const page = (head: string, body = '') =>
  `<!doctype html><html><head><meta charset="UTF-8">${head}</head><body>${body}</body></html>`;

describe('the policy (SEC-2)', () => {
  it('is SEC-2 verbatim for an ordinary route', () => {
    expect(serializePolicy(policyFor('/docs/intro'))).toBe(
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; " +
        "font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'",
    );
  });

  it('adds inline-script hashes to script-src only', () => {
    const policy = policyFor('/', {scriptHashes: ["'sha256-abc='"]});
    expect(policy['script-src']).toEqual(["'self'", "'sha256-abc='"]);
    expect(policy['style-src']).toEqual(["'self'"]);
  });

  it('refuses directives a meta policy ignores (SEC-1)', () => {
    for (const name of ['frame-ancestors', 'sandbox', 'report-uri', 'report-to']) {
      expect(() => serializePolicy({...STRICT_DIRECTIVES, [name]: ["'none'"]})).toThrow(/SEC-1/);
    }
  });

  it('renders as a meta http-equiv tag', () => {
    expect(cspMetaTag(STRICT_DIRECTIVES)).toMatch(
      /^<meta http-equiv="Content-Security-Policy" content="default-src 'self'; [^"]+">$/,
    );
  });
});

describe('per-route scoping (SEC-8)', () => {
  const relaxed = {surveyRelaxation: ['chrome-extension:']};

  it('grants no relaxation until SEC-7 decides one', () => {
    expect(SURVEY_SCRIPT_RELAXATION).toEqual([]);
    expect(policyFor('/survey')['script-src']).toEqual(["'self'"]);
  });

  it('applies a relaxation to the survey route and its children only', () => {
    expect(policyFor('/survey', relaxed)['script-src']).toContain('chrome-extension:');
    expect(policyFor('/survey/step-2', relaxed)['script-src']).toContain('chrome-extension:');
    for (const route of ['/', '/docs/intro', '/surveys', '/docs/survey']) {
      expect(policyFor(route, relaxed)['script-src'], route).toEqual(["'self'"]);
    }
  });

  it('accepts nothing but an extension scheme as a relaxation', () => {
    expect(EXTENSION_SCHEMES).toEqual(['chrome-extension:', 'moz-extension:']);
    for (const source of ["'unsafe-inline'", 'https:', '*', 'https://cdn.example']) {
      expect(() => policyFor('/survey', {surveyRelaxation: [source]})).toThrow(/SEC-8/);
    }
  });
});

describe('inline scripts (SEC-3)', () => {
  it('treats legacy JavaScript MIME types and import maps as inline script (SEC-3)', () => {
    const html = page(
      '<script type="text/ecmascript">a()</script><script type="importmap">{}</script>',
    );
    expect(inlineScripts(html)).toEqual(['a()', '{}']);
  });

  it('finds executable inline scripts, not external scripts or data blocks', () => {
    const html = page(
      '<script src="/a.js"></script><script type="application/ld+json">{}</script>' +
        `<script>${BOOTSTRAP}</script><script type="module">x()</script>`,
    );
    expect(inlineScripts(html)).toEqual([BOOTSTRAP, 'x()']);
  });

  it('recognises the colour-mode bootstrap', () => {
    expect(isColourModeBootstrap(BOOTSTRAP)).toBe(true);
    expect(isColourModeBootstrap('document.body.dataset.x=1')).toBe(false);
  });

  it('hashes the exact bytes', () => {
    expect(hashSource('alert(1)')).toBe("'sha256-bhHHL3z2vDgxUt0W3dWQOrprscmda2Y5pLsLg4GF+pI='");
  });
});

describe('applyPolicy', () => {
  it('puts the policy first after the charset, hashing the bootstrap', () => {
    const html = applyPolicy(
      page(`<link rel="stylesheet" href="/s.css"><script>${BOOTSTRAP}</script>`),
      '/',
      'index.html',
    );
    const meta = html.indexOf('Content-Security-Policy');
    expect(meta).toBeGreaterThan(html.indexOf('<meta charset="UTF-8">'));
    expect(meta).toBeLessThan(html.indexOf('<link'));
    expect(html).toContain(`script-src 'self' ${hashSource(BOOTSTRAP)};`);
  });

  it('hashes a bootstrap repeated on the page once', () => {
    const html = applyPolicy(
      page(`<script>${BOOTSTRAP}</script><script>${BOOTSTRAP}</script>`),
      '/',
      'x',
    );
    expect(html.split(hashSource(BOOTSTRAP))).toHaveLength(2);
  });

  it('drops the icon sprite inline style, which the policy would refuse', () => {
    const html = applyPolicy(page('', '<svg style="display: none;"><defs></defs></svg>'), '/', 'x');
    expect(html).toContain('<svg aria-hidden="true" data-dbs-icon-sprite=""><defs>');
    expect(html).not.toContain('style=');
  });

  it('fails the build on any other inline script', () => {
    expect(() => applyPolicy(page('<script>track()</script>'), '/', 'docs/a.html')).toThrow(
      /SEC-3: docs\/a.html has 1 inline script/,
    );
  });

  it('refuses a page that already has a policy, or no charset', () => {
    const twice = applyPolicy(page(''), '/', 'x');
    expect(() => applyPolicy(twice, '/', 'x')).toThrow(/already carries/);
    expect(() => applyPolicy('<html><head></head></html>', '/', 'x')).toThrow(/no <meta charset>/);
  });
});

describe('routeFile', () => {
  it.each([
    ['/b/', {route: '/', file: 'index.html'}],
    ['/b/docs/intro', {route: '/docs/intro', file: 'docs/intro/index.html'}],
    ['/b/docs/intro/', {route: '/docs/intro', file: 'docs/intro/index.html'}],
    ['/b/404.html', {route: '/404.html', file: '404.html'}],
  ])('maps %s', (route, expected) => {
    expect(routeFile(route, '/b/')).toEqual(expected);
  });

  it("maps a locale build's routes against the locale base, so policies are per page in every locale", () => {
    expect(routeFile('/b/ja/docs/intro', '/b/ja/')).toEqual({
      route: '/docs/intro',
      file: 'docs/intro/index.html',
    });
  });

  it('skips routes outside the base path', () => {
    expect(routeFile('/elsewhere', '/b/')).toBeNull();
  });
});

describe('applyPolicies and the plugin', () => {
  let outDir: string;

  beforeEach(async () => {
    outDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dbsync-security-'));
    await fs.mkdir(path.join(outDir, 'docs', 'intro'), {recursive: true});
    for (const file of ['index.html', 'docs/intro/index.html', '404.html']) {
      await fs.writeFile(path.join(outDir, file), page(`<script>${BOOTSTRAP}</script>`));
    }
  });

  afterEach(async () => {
    await fs.rm(outDir, {recursive: true, force: true});
  });

  it('writes the policy into every rendered page, once each', async () => {
    const written = await applyPolicies(
      outDir,
      ['/b/', '/b/docs/intro', '/b/docs/intro/', '/b/404.html', '/elsewhere'],
      '/b/',
    );
    expect(written).toEqual(['404.html', 'docs/intro/index.html', 'index.html']);
    for (const file of written) {
      const html = await fs.readFile(path.join(outDir, file), 'utf8');
      expect(html.match(/Content-Security-Policy/g), file).toHaveLength(1);
    }
  });

  it('uses the locale base path Docusaurus builds each locale under (i18n)', async () => {
    const plugin = securityPlugin({} as LoadContext);
    await plugin.postBuild?.({
      outDir,
      baseUrl: '/fr/',
      routesPaths: ['/fr/', '/fr/docs/intro'],
    } as Parameters<NonNullable<typeof plugin.postBuild>>[0]);
    for (const file of ['index.html', 'docs/intro/index.html']) {
      expect(await fs.readFile(path.join(outDir, file), 'utf8'), file).toMatch(
        /Content-Security-Policy/,
      );
    }
  });

  it('runs from postBuild with the profile base path', async () => {
    const previous = process.env.DOCS_PROFILE;
    process.env.DOCS_PROFILE = 'prod';
    try {
      const plugin = securityPlugin({baseUrl: '/'} as LoadContext);
      expect(plugin.name).toBe('dbsync-security');
      await plugin.postBuild?.({outDir, baseUrl: '/', routesPaths: ['/']} as Parameters<
        NonNullable<typeof plugin.postBuild>
      >[0]);
      expect(await fs.readFile(path.join(outDir, 'index.html'), 'utf8')).toMatch(
        /Content-Security-Policy/,
      );
    } finally {
      if (previous === undefined) {
        delete process.env.DOCS_PROFILE;
      } else {
        process.env.DOCS_PROFILE = previous;
      }
    }
  });
});

describe('emitFontsAsFiles (SEC-2)', () => {
  const config = (): Configuration => ({
    module: {
      rules: [
        {
          test: /\.(?:ico|png)$/i,
          use: [{loader: '/x/url-loader/index.js', options: {limit: 10000}}],
        },
        {
          test: /\.(?:woff2?|eot|ttf|otf)$/i,
          use: [{loader: '/x/url-loader/index.js', options: {limit: 10000}}],
        },
      ],
    },
  });

  it('stops inlining fonts as data: URIs, and leaves images alone', () => {
    const c = config();
    expect(emitFontsAsFiles(c)).toBe(1);
    const [images, fonts] = c.module!.rules as {use: {options: {limit: unknown}}[]}[];
    expect(fonts.use[0].options.limit).toBe(false);
    expect(images.use[0].options.limit).toBe(10000);
  });

  it('fails the build when Docusaurus no longer has the rule', () => {
    expect(() => emitFontsAsFiles({})).toThrow(/SEC-2/);
    const fileLoaderOnly: Configuration = {
      module: {
        rules: [
          {test: /\.woff2$/, use: 'file-loader'},
          {test: /\.woff2$/, use: [{loader: 'file-loader', options: {}}]},
        ],
      },
    };
    expect(() => emitFontsAsFiles(fileLoaderOnly)).toThrow(/no font url-loader found/);
  });

  it('is wired into configureWebpack', () => {
    const previous = process.env.DOCS_PROFILE;
    process.env.DOCS_PROFILE = 'dev';
    try {
      const plugin = securityPlugin({baseUrl: '/'} as LoadContext);
      const c = config();
      expect((plugin.configureWebpack as unknown as (c: Configuration) => object)(c)).toEqual({});
      expect(
        (c.module!.rules![1] as {use: {options: {limit: unknown}}[]}).use[0].options.limit,
      ).toBe(false);
    } finally {
      if (previous === undefined) {
        delete process.env.DOCS_PROFILE;
      } else {
        process.env.DOCS_PROFILE = previous;
      }
    }
  });
});
