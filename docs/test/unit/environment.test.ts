import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {afterEach, beforeEach, describe, expect, it} from 'vitest';

import {PROFILES} from '../../config/profiles';
import environmentPlugin, {
  NOINDEX_HTML,
  NOINDEX_META,
  ROBOTS_FILE,
  cacheByProfile,
  isRootBuild,
  localesDefaultFirst,
  emitRobots,
  environmentHeadTags,
  robotsTxt,
} from '../../plugins/environment';
import type {LoadContext} from '@docusaurus/types';

let outDir: string;

beforeEach(async () => {
  outDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dbsync-environment-'));
});

afterEach(async () => {
  await fs.rm(outDir, {recursive: true, force: true});
});

const readRobots = () => fs.readFile(path.join(outDir, ROBOTS_FILE), 'utf8');

describe('ENV-3: noindex with crawling allowed', () => {
  it('puts noindex, and only noindex, on every page of the preview build', () => {
    expect(environmentHeadTags(PROFILES.dev)).toEqual([
      {tagName: 'meta', attributes: {name: 'robots', content: 'noindex'}},
    ]);
  });

  it('writes the same directive as markup for hand-built pages', () => {
    const {name, content} = NOINDEX_META.attributes as Record<string, string>;
    expect(NOINDEX_HTML).toBe(`<meta name="${name}" content="${content}">`);
  });

  it('adds no robots meta to production', () => {
    expect(environmentHeadTags(PROFILES.prod)).toEqual([]);
  });

  it.each([PROFILES.dev, PROFILES.prod])('never disallows crawling ($name)', (profile) => {
    const robots = robotsTxt(profile);
    expect(robots).toMatch(/^User-agent: \*\nAllow: \/\n/);
    expect(robots).not.toMatch(/Disallow/i);
  });

  it('advertises the sitemap only on the indexable build', () => {
    expect(robotsTxt(PROFILES.prod)).toContain(
      'Sitemap: https://dbsync.cardano.intersect.org/sitemap.xml',
    );
    expect(robotsTxt(PROFILES.dev)).not.toMatch(/Sitemap/);
  });

  it('replaces a robots.txt that reached the output with a Disallow', async () => {
    await fs.writeFile(path.join(outDir, ROBOTS_FILE), 'User-agent: *\nDisallow: /\n');
    await emitRobots(outDir, PROFILES.dev);
    expect(await readRobots()).toBe(robotsTxt(PROFILES.dev));
  });
});

describe('cacheByProfile (ENV-1)', () => {
  it('gives each profile its own webpack filesystem cache', () => {
    const dev = {cache: {type: 'filesystem' as const, name: 'client-production-en'}};
    const prod = {cache: {type: 'filesystem' as const, name: 'client-production-en'}};
    cacheByProfile(dev, PROFILES.dev);
    cacheByProfile(prod, PROFILES.prod);
    expect(dev.cache.name).toBe('client-production-en-dev');
    expect(prod.cache.name).toBe('client-production-en-prod');
  });

  it('leaves a memory cache, or none, alone', () => {
    const memory = {cache: {type: 'memory' as const}};
    cacheByProfile(memory, PROFILES.dev);
    expect(memory.cache).toEqual({type: 'memory'});
    expect(() => cacheByProfile({}, PROFILES.dev)).not.toThrow();
    const unnamed = {cache: {type: 'filesystem' as const}};
    cacheByProfile(unnamed, PROFILES.prod);
    expect(unnamed.cache).toEqual({type: 'filesystem', name: 'default-prod'});
  });
});

describe('locale builds', () => {
  const i18n = {currentLocale: 'ja', defaultLocale: 'en', locales: ['ja', 'en', 'de']};

  it('treats only the default locale build as the site root', () => {
    expect(isRootBuild({i18n} as LoadContext)).toBe(false);
    expect(isRootBuild({i18n: {...i18n, currentLocale: 'en'}} as LoadContext)).toBe(true);
  });

  it('lists the locales default first', () => {
    expect(localesDefaultFirst({i18n} as LoadContext)).toEqual(['en', 'ja', 'de']);
  });

  it('points production robots.txt at every locale sitemap', () => {
    expect(robotsTxt(PROFILES.prod, ['en', 'ja'])).toBe(
      'User-agent: *\nAllow: /\n\n' +
        'Sitemap: https://dbsync.cardano.intersect.org/sitemap.xml\n' +
        'Sitemap: https://dbsync.cardano.intersect.org/ja/sitemap.xml\n',
    );
  });
});

describe('environmentPlugin', () => {
  const context = {
    i18n: {currentLocale: 'en', defaultLocale: 'en', locales: ['en', 'ja']},
  } as LoadContext;

  async function withProfile<T>(name: string, fn: () => Promise<T> | T): Promise<T> {
    const previous = process.env.DOCS_PROFILE;
    process.env.DOCS_PROFILE = name;
    try {
      return await fn();
    } finally {
      if (previous === undefined) {
        delete process.env.DOCS_PROFILE;
      } else {
        process.env.DOCS_PROFILE = previous;
      }
    }
  }

  it('injects the profile head tags and writes robots.txt after the build', async () => {
    const plugin = await withProfile('dev', () => environmentPlugin(context));
    expect(plugin.name).toBe('dbsync-environment');
    expect(plugin.injectHtmlTags?.({content: undefined})).toEqual({headTags: [NOINDEX_META]});
    const config = {cache: {type: 'filesystem' as const, name: 'server-production-en'}};
    expect((plugin.configureWebpack as unknown as (c: object) => object)(config)).toEqual({});
    expect(config.cache.name).toBe('server-production-en-dev');
    await plugin.postBuild?.({outDir} as Parameters<NonNullable<typeof plugin.postBuild>>[0]);
    expect(await readRobots()).toBe(robotsTxt(PROFILES.dev));
  });

  it("writes no robots.txt from a non-default locale's build", async () => {
    const ja = {...context, i18n: {...context.i18n, currentLocale: 'ja'}} as LoadContext;
    const plugin = await withProfile('prod', () => environmentPlugin(ja));
    await plugin.postBuild?.({outDir} as Parameters<NonNullable<typeof plugin.postBuild>>[0]);
    await expect(readRobots()).rejects.toThrow(/ENOENT/);
  });
});
