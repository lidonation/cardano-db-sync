import {execFile} from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import {promisify} from 'node:util';

import {beforeAll, describe, expect, it} from 'vitest';
import {load} from 'cheerio';

import {DEFAULT_LOCALE, LOCALES} from '../../config/i18n';
import {PROFILES} from '../../config/profiles';
import {PALETTE_BOOTSTRAP} from '../../src/lib/palette';
import {inlineScripts} from '../../plugins/security';
import {faqPageProblems} from '../../scripts/lib/faq-jsonld.mjs';
import {localeSites, measure} from '../../scripts/check-asset-budget.mjs';

const run = promisify(execFile);
const DOCS_ROOT = path.resolve(import.meta.dirname, '../..');

const OUT = {
  dev: path.join(DOCS_ROOT, 'build', 'dev'),
  prod: path.join(DOCS_ROOT, 'build', 'prod'),
};

async function exists(target: string): Promise<boolean> {
  try {
    await fs.stat(target);
    return true;
  } catch {
    return false;
  }
}

/**
 * B01 DoD: both profiles build clean from one working tree. The two builds run back to back in
 * the same checkout, which is the case that catches a profile value leaking through a cache.
 */
beforeAll(async () => {
  await fs.rm(path.join(DOCS_ROOT, 'build'), {recursive: true, force: true});
  await run('npm', ['run', 'build:dev'], {cwd: DOCS_ROOT, maxBuffer: 64 * 1024 * 1024});
  await run('npm', ['run', 'build:prod'], {cwd: DOCS_ROOT, maxBuffer: 64 * 1024 * 1024});
}, 900_000);

describe('both profiles build from one working tree', () => {
  it('emits an index page for each profile', async () => {
    expect(await exists(path.join(OUT.dev, 'index.html'))).toBe(true);
    expect(await exists(path.join(OUT.prod, 'index.html'))).toBe(true);
  });

  it('emits the seed docs page under each profile', async () => {
    expect(await exists(path.join(OUT.dev, 'docs', 'intro', 'index.html'))).toBe(true);
    expect(await exists(path.join(OUT.prod, 'docs', 'intro', 'index.html'))).toBe(true);
  });
});

describe('headless prose indexes (SRCH-10)', () => {
  for (const profile of ['dev', 'prod'] as const) {
    for (const locale of LOCALES) {
      it(`emits the current version index for ${profile} ${locale}`, async () => {
        const prefix = locale === DEFAULT_LOCALE ? '' : locale;
        const bundle = path.join(OUT[profile], prefix, 'pagefind', 'current');
        const entry = JSON.parse(await fs.readFile(path.join(bundle, 'pagefind-entry.json'), 'utf8'));
        expect(entry.languages[locale].page_count).toBeGreaterThan(0);
        expect(await exists(path.join(OUT[profile], prefix, 'pagefind/_runtime/pagefind.js'))).toBe(true);
        expect(await exists(path.join(bundle, 'pagefind.js'))).toBe(false);
        expect(await exists(path.join(bundle, 'pagefind-worker.js'))).toBe(false);
        expect(await exists(path.join(OUT[profile], prefix, 'pagefind/_runtime/prose-worker.js'))).toBe(true);
        expect(await exists(path.join(bundle, 'pagefind-ui.js'))).toBe(false);
      });
    }
  }
});

describe('CNAME is a production-only artifact (ENV-6)', () => {
  it('does not write a CNAME into the developer output', async () => {
    expect(await exists(path.join(OUT.dev, 'CNAME'))).toBe(false);
  });

  it('writes the production host into the production output', async () => {
    const contents = await fs.readFile(path.join(OUT.prod, 'CNAME'), 'utf8');
    expect(contents.trim()).toBe(PROFILES.prod.cname);
  });
});

describe('baseUrl reaches the emitted HTML (ENV-1)', () => {
  it('prefixes developer asset paths with the subpath', async () => {
    const html = await fs.readFile(path.join(OUT.dev, 'index.html'), 'utf8');
    expect(html).toMatch(/(href|src)="\/cardano-db-sync\/assets\//);
  });

  it('serves production asset paths from the root', async () => {
    const html = await fs.readFile(path.join(OUT.prod, 'index.html'), 'utf8');
    expect(html).toMatch(/(href|src)="\/assets\//);
    expect(html).not.toMatch(/\/cardano-db-sync\/assets\//);
  });

  it('keeps the developer subpath out of the production output entirely', async () => {
    const html = await fs.readFile(path.join(OUT.prod, 'docs', 'intro', 'index.html'), 'utf8');
    expect(html).not.toContain('/cardano-db-sync/assets/');
  });

  it('keeps it out of production CSS and JS too, though dev built first in the same tree', async () => {
    const assets = (await fs.readdir(path.join(OUT.prod, 'assets'), {recursive: true})).filter(
      (f) => /\.(?:css|js)$/.test(f),
    );
    expect(assets.length).toBeGreaterThan(0);
    for (const file of assets) {
      const text = await fs.readFile(path.join(OUT.prod, 'assets', file), 'utf8');
      expect(text, file).not.toContain('/cardano-db-sync/assets/');
    }
    const css = await fs.readFile(
      path.join(
        OUT.dev,
        'assets',
        'css',
        (await fs.readdir(path.join(OUT.dev, 'assets', 'css')))[0],
      ),
      'utf8',
    );
    expect(css).toContain('/cardano-db-sync/assets/fonts/');
  });
});

describe('the build carries no secrets and needs none (ENV-5)', () => {
  it('builds with an environment that has only the profile variable set', async () => {
    const {stdout} = await run('npm', ['run', 'build:dev'], {
      cwd: DOCS_ROOT,
      maxBuffer: 64 * 1024 * 1024,
      env: {
        PATH: process.env.PATH ?? '',
        HOME: process.env.HOME ?? '',
        DOCS_PROFILE: 'dev',
      },
    });
    expect(stdout).toContain('Generated static files');
  }, 900_000);
});

describe('theme tokens reach the built CSS with their precedence intact (TOK-1, THM-1)', () => {
  /**
   * The minifier reorders and merges rules, so a theme block that only beat `:root` by coming
   * later can land above it and lose. Every theme rule must out-rank `:root` on specificity.
   * THM-1: tokens key off `data-dbs-palette`, never `data-theme` (which drives Infima alone).
   */
  it('scopes every themed token rule as :root[data-dbs-palette=...]', async () => {
    const dir = path.join(OUT.prod, 'assets', 'css');
    const css = (
      await Promise.all((await fs.readdir(dir)).map((f) => fs.readFile(path.join(dir, f), 'utf8')))
    ).join('');
    const themed = [...css.matchAll(/([^{}]*data-dbs-palette[^{}]*)\{([^{}]*)\}/g)]
      .filter(([, , body]) => body.includes('--dbs-'))
      .map(([, selector]) => selector.trim());
    expect(themed.length).toBeGreaterThanOrEqual(3);
    for (const selector of themed) {
      for (const part of selector.split(',')) {
        expect(part, selector).toMatch(/^:root\[data-dbs-palette=/);
      }
    }
    // No token is defined under data-theme: that attribute belongs to Infima (§14.2). The Infima
    // bridge may read --dbs-* tokens there to out-rank Infima's dark rule, but never define one.
    const stray = [...css.matchAll(/([^{}]*data-theme[^{}]*)\{([^{}]*)\}/g)]
      .filter(([, , body]) => /(?:^|;)\s*--dbs-[\w-]+\s*:/.test(body))
      .map(([, selector]) => selector.trim());
    expect(stray).toEqual([]);
  });
});

/** Every HTML file under a build output, as paths relative to it. */
async function htmlFiles(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, {recursive: true});
  return entries.filter((f) => f.endsWith('.html')).sort();
}

const NOINDEX = /<meta[^>]*name="robots"[^>]*content="noindex"/;

describe('preview is noindex and crawlable; production is neither blocked nor noindex (ENV-3)', () => {
  it('serves noindex on every preview page while robots.txt allows crawling', async () => {
    const pages = await htmlFiles(OUT.dev);
    expect(pages).toContain('404.html');
    for (const page of pages) {
      expect(await fs.readFile(path.join(OUT.dev, page), 'utf8'), page).toMatch(NOINDEX);
    }
    const robots = await fs.readFile(path.join(OUT.dev, 'robots.txt'), 'utf8');
    expect(robots).toMatch(/^User-agent: \*\nAllow: \/$/m);
    expect(robots).not.toMatch(/Disallow/i);
  });

  it('serves no noindex anywhere in production, and does not disallow crawling', async () => {
    for (const page of await htmlFiles(OUT.prod)) {
      // The robots directive, not the word: a page may well document noindex.
      expect(await fs.readFile(path.join(OUT.prod, page), 'utf8'), page).not.toMatch(NOINDEX);
    }
    const robots = await fs.readFile(path.join(OUT.prod, 'robots.txt'), 'utf8');
    expect(robots).not.toMatch(/Disallow/i);
  });
});

describe('environment banner (ENV-4)', () => {
  it('labels every preview page, linking to production', async () => {
    for (const page of await htmlFiles(OUT.dev)) {
      const html = await fs.readFile(path.join(OUT.dev, page), 'utf8');
      expect(html, page).toMatch(/<aside[^>]*aria-label="Build environment"[^>]*>/);
      expect(html, page).toContain('data-environment="preview"');
      expect(html, page).toContain('href="https://dbsync.cardano.intersect.org/"');
    }
  });

  it('is absent from every production page', async () => {
    for (const page of await htmlFiles(OUT.prod)) {
      const html = await fs.readFile(path.join(OUT.prod, page), 'utf8');
      expect(html, page).not.toContain('data-environment');
    }
  });
});

describe('five locales (A11Y-18, META-4, META-8)', () => {
  const LOCALE_DIRS = {en: '', ja: 'ja', es: 'es', de: 'de', vi: 'vi'};
  const page = (out: string, locale: string, route: string) =>
    path.join(out, LOCALE_DIRS[locale as keyof typeof LOCALE_DIRS], route, 'index.html');
  const alternates = (html: string) =>
    [...html.matchAll(/<link[^>]*rel="alternate"[^>]*hreflang="([^"]+)"/g)].map((m) => m[1]);

  it('builds every locale in both profiles, each with its own lang and dir', async () => {
    for (const out of [OUT.dev, OUT.prod]) {
      for (const locale of Object.keys(LOCALE_DIRS)) {
        const html = await fs.readFile(page(out, locale, ''), 'utf8');
        expect(html, `${out} ${locale}`).toMatch(new RegExp(`<html lang="${locale}" dir="ltr"`));
      }
    }
  });

  it('advertises an untranslated doc in English only, from every locale (META-4)', async () => {
    for (const locale of Object.keys(LOCALE_DIRS)) {
      const html = await fs.readFile(page(OUT.prod, locale, 'docs/intro'), 'utf8');
      expect(alternates(html), locale).toEqual(['en', 'x-default']);
    }
  });

  it('advertises a page that exists everywhere in every locale, reciprocally (META-4)', async () => {
    for (const locale of Object.keys(LOCALE_DIRS)) {
      const html = await fs.readFile(page(OUT.prod, locale, ''), 'utf8');
      expect(alternates(html), locale).toEqual(['en', 'ja', 'es', 'de', 'vi', 'x-default']);
    }
  });

  it("points an untranslated doc's canonical at the English page; others are self-canonical", async () => {
    const canonical = (html: string) =>
      html.match(/<link[^>]*rel="canonical"[^>]*href="([^"]+)"/)?.[1];
    const en = canonical(await fs.readFile(page(OUT.prod, 'en', 'docs/intro'), 'utf8'));
    expect(en).toMatch(/\/docs\/intro\/?$/);
    expect(en).not.toMatch(/\/(ja|es|de|vi)\//);
    for (const locale of ['ja', 'es', 'de', 'vi']) {
      const doc = await fs.readFile(page(OUT.prod, locale, 'docs/intro'), 'utf8');
      expect(canonical(doc), locale).toBe(en);
      const home = await fs.readFile(page(OUT.prod, locale, ''), 'utf8');
      expect(canonical(home), locale).toMatch(new RegExp(`/${locale}/?$`));
    }
  });

  it('emits no hreflang at all on the noindex preview (META-8)', async () => {
    for (const locale of Object.keys(LOCALE_DIRS)) {
      for (const route of ['', 'docs/intro']) {
        const html = await fs.readFile(page(OUT.dev, locale, route), 'utf8');
        expect(alternates(html), `${locale} ${route}`).toEqual([]);
      }
    }
  });

  it('marks an untranslated doc as English inside a translated page (A11Y-18)', async () => {
    const en = await fs.readFile(page(OUT.prod, 'en', 'docs/intro'), 'utf8');
    const ja = await fs.readFile(page(OUT.prod, 'ja', 'docs/intro'), 'utf8');
    expect(ja).toMatch(/<div lang="en"><div class="theme-doc-markdown/);
    expect(en).not.toMatch(/<div lang="en"><div class="theme-doc-markdown/);
  });

  it('renders identifiers as untranslated English in every locale (A11Y-18)', async () => {
    for (const locale of Object.keys(LOCALE_DIRS)) {
      const html = await fs.readFile(page(OUT.prod, locale, 'docs/intro'), 'utf8');
      expect(html, locale).toMatch(/<code lang="en" translate="no">cardano-db-sync<\/code>/);
    }
  });
});

describe('palette bootstrap ordering (THM-1)', () => {
  it('ships exact palette bytes after the framework bootstrap and before rendered content', async () => {
    for (const out of [OUT.dev, OUT.prod]) {
      for (const page of await htmlFiles(out)) {
        const html = await fs.readFile(path.join(out, page), 'utf8');
        const scripts = inlineScripts(html);
        const palette = scripts.indexOf(PALETTE_BOOTSTRAP);
        const framework = scripts.findIndex(
          (code) =>
            !code.includes('dbs-palette') &&
            code.includes('localStorage.getItem("theme")') &&
            code.includes('"data-theme"'),
        );
        expect(framework, `${out}/${page}`).toBeGreaterThanOrEqual(0);
        expect(palette, `${out}/${page}`).toBeGreaterThan(framework);
        expect(
          scripts.filter((code) => code.includes('dbs-palette')),
          `${out}/${page}`,
        ).toEqual([PALETTE_BOOTSTRAP]);
        expect(html.indexOf(PALETTE_BOOTSTRAP), `${out}/${page}`).toBeLessThan(
          html.indexOf('id="__docusaurus"'),
        );
      }
    }
  });
});

describe('the FAQ page carries FAQPage JSON-LD that matches it (META-2, B44-c)', () => {
  for (const profile of ['dev', 'prod'] as const) {
    for (const locale of LOCALES) {
      it(`in the ${profile} ${locale} build`, async () => {
        const prefix = locale === DEFAULT_LOCALE ? '' : locale;
        const html = await fs.readFile(
          path.join(OUT[profile], prefix, 'faq', 'index.html'),
          'utf8',
        );
        expect(faqPageProblems(html)).toEqual([]);
      });
    }
  }
});

describe('Updates page and fixture isolation (B44-d, VER-5, A11Y-18)', () => {
  for (const profile of ['dev', 'prod'] as const) {
    for (const locale of LOCALES) {
      it(`emits an honest Updates fallback in ${profile} ${locale}`, async () => {
        const prefix = locale === DEFAULT_LOCALE ? '' : locale;
        const html = await fs.readFile(path.join(OUT[profile], prefix, 'updates', 'index.html'), 'utf8');
        expect(html).toContain('The Updates feed is not available yet.');
        expect(html).toMatch(locale === DEFAULT_LOCALE ? /<html[^>]*lang="en"/ : /<main[^>]*lang="en"/);
        expect(html).toMatch(/<main[^>]*id="dbs-main-content"[^>]*tabindex="-1"/);
        expect(html).toContain('role="tablist"');
        expect(html).toContain('role="status"');
        expect(html).not.toContain('example.com/current');
        expect(await exists(path.join(OUT[profile], prefix, '__updates', 'index.html'))).toBe(false);
      });
    }
  }
});

describe('global brand icons survive localized builds (#63)', () => {
  for (const name of ['dev', 'prod'] as const) {
    it(`${name}: every page points at the global icons and their published bytes`, async () => {
      const profile = PROFILES[name];
      const icons = {
        icon: 'brand/png/mark-badge-32.png',
        'apple-touch-icon': 'brand/png/mark-badge-180.png',
      };
      for (const page of await htmlFiles(OUT[name])) {
        const $ = load(await fs.readFile(path.join(OUT[name], page), 'utf8'));
        for (const [rel, file] of Object.entries(icons)) {
          const links = $(`link[rel="${rel}"]`);
          expect(links.length, `${name} ${page} ${rel}`).toBe(1);
          const href = links.attr('href')!;
          expect(href, `${name} ${page} ${rel}`).toBe(`${profile.baseUrl}${file}`);
          const url = new URL(href, profile.url);
          expect(url.origin, `${name} ${page} ${rel}`).toBe(profile.url);
          expect(url.pathname, `${name} ${page} ${rel}`).toBe(`${profile.baseUrl}${file}`);
        }
      }
      const files = (
        await fs.readdir(path.join(DOCS_ROOT, 'static/brand'), {recursive: true})
      ).filter((file) => /\.(png|svg)$/.test(file));
      expect(files).toHaveLength(47);
      for (const file of files) {
        expect(await fs.readFile(path.join(OUT[name], 'brand', file)), `${name} ${file}`).toEqual(
          await fs.readFile(path.join(DOCS_ROOT, 'static/brand', file)),
        );
      }
    });
  }
});

describe('Numbers production isolation (NUM-5)', () => {
  it('excludes synthetic fixtures from routes, manifests and bundles in both profiles', async () => {
    const forbidden =
      /__numbers|Synthetic browser test fixture, not a provider measurement|Synthetic estimates for browser test only/;
    const walk = async (dir: string): Promise<string[]> => {
      const entries = await fs.readdir(dir, {withFileTypes: true});
      return (
        await Promise.all(
          entries.map((e) =>
            e.isDirectory()
              ? walk(path.join(dir, e.name))
              : Promise.resolve([path.join(dir, e.name)]),
          ),
        )
      ).flat();
    };
    for (const root of Object.values(OUT)) {
      for (const file of await walk(root)) {
        expect(file).not.toContain('__numbers');
        if (/\.(?:html|js|json)$/.test(file))
          expect(await fs.readFile(file, 'utf8'), file).not.toMatch(forbidden);
      }
    }
    expect(
      await fs.readFile(path.join(DOCS_ROOT, 'config/route-manifest.json'), 'utf8'),
    ).not.toContain('__numbers');
  });
});

describe('homepage Prism payload (B51)', () => {
  for (const locale of ['en', 'ja'] as const) {
    it(`keeps the Prism renderer out of the ${locale} dev homepage initial scripts`, async () => {
      const root = locale === 'en' ? OUT.dev : path.join(OUT.dev, locale);
      const html = await fs.readFile(path.join(root, 'index.html'), 'utf8');
      const $ = load(html);
      const scripts = $('script[src]').toArray();
      expect(scripts.length).toBeGreaterThan(0);
      // Use the shipping gate's locale isolation, URL resolution and gzip accounting.
      const {pages} = await measure(root, await localeSites(root));
      const homepage = pages.find((page) => page.page === 'index.html');
      expect(homepage).toBeDefined();
      expect(homepage!.bytes).toBeLessThanOrEqual(150 * 1024);
      for (const script of scripts) {
        const url = $(script).attr('src')!;
        const relative = url.slice(url.indexOf('/assets/') + 1);
        const contents = await fs.readFile(path.join(root, relative), 'utf8');
        expect(contents).not.toContain('highlightAllUnder');
      }
    });
  }
});
