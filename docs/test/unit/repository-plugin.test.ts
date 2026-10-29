import {mkdir, mkdtemp, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import type {LoadContext, Plugin} from '@docusaurus/types';
import {afterEach, describe, expect, it, vi} from 'vitest';
import repositoryActivity from '../../plugins/repository-activity';

const originalCache = process.env.REPOSITORY_ACTIVITY_CACHE;
const originalCheckout = process.env.REPOSITORY_CHECKOUT;
const originalToken = process.env.GITHUB_TOKEN;
const dirs: string[] = [];
afterEach(async () => {
  if (originalCache === undefined) delete process.env.REPOSITORY_ACTIVITY_CACHE;
  else process.env.REPOSITORY_ACTIVITY_CACHE = originalCache;
  if (originalCheckout === undefined) delete process.env.REPOSITORY_CHECKOUT;
  else process.env.REPOSITORY_CHECKOUT = originalCheckout;
  if (originalToken === undefined) delete process.env.GITHUB_TOKEN;
  else process.env.GITHUB_TOKEN = originalToken;
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, {recursive: true, force: true})));
});

async function load(cache: string, outDir?: string) {
  process.env.REPOSITORY_ACTIVITY_CACHE = cache;
  delete process.env.REPOSITORY_CHECKOUT;
  delete process.env.GITHUB_TOKEN;
  const plugin = repositoryActivity({siteDir: process.cwd()} as LoadContext);
  const createData = vi.fn(async (_name: string, data: string) => data);
  await plugin.contentLoaded!({actions: {createData}} as unknown as Parameters<
    NonNullable<Plugin['contentLoaded']>
  >[0]);
  if (outDir) await plugin.postBuild!({outDir} as Parameters<NonNullable<Plugin['postBuild']>>[0]);
  expect(createData.mock.calls.map(([name]) => name)).toEqual([
    'resolved.json',
    'history.json',
    'commits.json',
  ]);
  return {
    summary: JSON.parse(createData.mock.calls[0][1]),
    history: JSON.parse(createData.mock.calls[1][1]),
    commits: JSON.parse(createData.mock.calls[2][1]),
  };
}

describe('Docusaurus repository plugin', () => {
  it('loads a last good cache without network access', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'activity-cache-'));
    dirs.push(dir);
    const fixture = await readFile('test/fixtures/repository-activity/data.json', 'utf8');
    await writeFile(path.join(dir, 'data.json'), fixture);
    const result = await load(dir);
    expect(result.summary.status).toBe('available');
    expect(result.summary.data.contributors).toHaveLength(2);
    expect(result.summary.data.commits).toBeUndefined();
    expect(result.summary.data.charts.monthly).toHaveLength(12);
    expect(result.summary.data.charts.daily).toHaveLength(30);
    expect(result.summary.data.charts.weeks).toHaveLength(52);
    expect(JSON.stringify(result.summary.data.charts)).not.toContain('Erik');
    expect(result.history.data.commits).toHaveLength(2);
    expect(result.commits.data.entries).toHaveLength(2);
    expect(result.commits.data.entries[0]).toEqual({
      id: 'a'.repeat(40),
      date: '2025-06-01',
      subject: 'first',
    });
    expect(result.commits.data.entries[0].author).toBeUndefined();
    expect(result.history.data.dailyLines).toHaveLength(1);
  });
  it('builds charts from accepted cache timestamps using their UTC date', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'activity-timestamp-'));
    dirs.push(dir);
    const fixture = JSON.parse(
      await readFile('test/fixtures/repository-activity/data.json', 'utf8'),
    );
    fixture.builtAt = 'June 1, 2026 23:30:00 GMT-0300';
    await writeFile(path.join(dir, 'data.json'), JSON.stringify(fixture));
    const result = await load(dir);
    expect(result.summary.status).toBe('available');
    expect(result.summary.data.charts.daily.at(-1).date).toBe('2026-06-02');
  });
  it('publishes only referenced avatars, never unrelated cache files', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'activity-publish-'));
    dirs.push(dir);
    const fixture = 'test/fixtures/repository-activity';
    await writeFile(path.join(dir, 'data.json'), await readFile(`${fixture}/data.json`));
    await mkdir(path.join(dir, 'avatars'));
    const image = 'c'.repeat(64) + '.png';
    await writeFile(
      path.join(dir, 'avatars', image),
      await readFile(`${fixture}/avatars/${image}`),
    );
    await writeFile(path.join(dir, 'avatars', 'private.json'), 'not for publication');
    await writeFile(path.join(dir, 'avatars', 'd'.repeat(64) + '.png'), 'obsolete');
    const outDir = path.join(dir, 'out');
    await load(dir, outDir);
    expect(await readdir(path.join(outDir, 'repository-avatars'))).toEqual([image]);
  });
  it('does not fail builds when the cache is absent or invalid', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'activity-missing-'));
    dirs.push(dir);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(await load(dir)).toEqual({
        summary: {status: 'unavailable'},
        history: {status: 'unavailable'},
        commits: {status: 'unavailable'},
      });
    } finally {
      warn.mockRestore();
    }
  });
});
