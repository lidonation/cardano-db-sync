import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {afterEach, beforeEach, describe, expect, it} from 'vitest';

import {PROFILES} from '../../config/profiles';
import environmentPlugin, {
  NOINDEX_META,
  ROBOTS_FILE,
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

describe('environmentPlugin', () => {
  const context = {} as LoadContext;

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
    await plugin.postBuild?.({outDir} as Parameters<NonNullable<typeof plugin.postBuild>>[0]);
    expect(await readRobots()).toBe(robotsTxt(PROFILES.dev));
  });
});
