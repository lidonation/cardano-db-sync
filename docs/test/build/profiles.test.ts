import {execFile} from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import {promisify} from 'node:util';

import {beforeAll, describe, expect, it} from 'vitest';

import {PROFILES} from '../../config/profiles';

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

describe('theme tokens reach the built CSS with their precedence intact (TOK-1)', () => {
  /**
   * The minifier reorders and merges rules, so a theme block that only beat `:root` by coming
   * later can land above it and lose. Every theme rule must out-rank `:root` on specificity.
   */
  it('scopes every themed token rule as :root[data-theme=...]', async () => {
    const dir = path.join(OUT.prod, 'assets', 'css');
    const css = (await Promise.all((await fs.readdir(dir)).map((f) => fs.readFile(path.join(dir, f), 'utf8')))).join('');
    const themed = [...css.matchAll(/([^{}]*data-theme[^{}]*)\{([^{}]*)\}/g)]
      .filter(([, , body]) => body.includes('--dbs-'))
      .map(([, selector]) => selector.trim());
    expect(themed.length).toBeGreaterThanOrEqual(3);
    for (const selector of themed) {
      for (const part of selector.split(',')) {
        expect(part, selector).toMatch(/^:root\[data-theme=/);
      }
    }
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
