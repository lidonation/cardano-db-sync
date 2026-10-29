import {mkdtemp, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import type {LoadContext, Plugin} from '@docusaurus/types';
import {afterEach, expect, it, vi} from 'vitest';
import roadmap from '../../plugins/roadmap';
import {parseCache} from '../../plugins/roadmap/cache';
import {readRoadmap} from '../../plugins/roadmap/source';
import fixture from '../fixtures/roadmap-cache/data.json';

vi.mock('../../plugins/roadmap/source', () => ({readRoadmap: vi.fn()}));
const data = parseCache(JSON.stringify(fixture));
const dirs: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.mocked(readRoadmap).mockReset();
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, {recursive: true, force: true})));
});
async function directory() {
  const dir = await mkdtemp(path.join(tmpdir(), 'roadmap-review-'));
  dirs.push(dir);
  return dir;
}
async function load(cache: string) {
  vi.stubEnv('ROADMAP_CACHE', cache);
  const plugin = roadmap({siteDir: process.cwd()} as LoadContext);
  const createData = vi.fn(async (_name: string, json: string) => json);
  await plugin.contentLoaded!({actions: {createData}} as unknown as Parameters<
    NonNullable<Plugin['contentLoaded']>
  >[0]);
  expect(createData.mock.calls.map(([name]) => name)).toEqual(['resolved.json']);
  return JSON.parse(createData.mock.calls[0][1]);
}
it('publishes fresh validated data and atomically saves the same snapshot', async () => {
  vi.stubEnv('ROADMAP_OFFLINE', '0');
  vi.mocked(readRoadmap).mockResolvedValue(data);
  const dir = await directory();
  expect(await load(dir)).toEqual({status: 'available', data});
  expect(parseCache(await readFile(path.join(dir, 'data.json'), 'utf8'))).toEqual(data);
  expect(await readdir(dir)).toEqual(['data.json']);
});
it('keeps the last-good cache and original date when the source fails', async () => {
  vi.stubEnv('ROADMAP_OFFLINE', '0');
  vi.mocked(readRoadmap).mockRejectedValue(new Error('snapshot deadline'));
  const dir = await directory();
  const cache = JSON.stringify(data);
  await writeFile(path.join(dir, 'data.json'), cache);
  expect(await load(dir)).toEqual({status: 'available', data});
  expect(await readFile(path.join(dir, 'data.json'), 'utf8')).toBe(cache);
});
it('generates unavailable data without failing on missing or corrupt offline caches', async () => {
  vi.stubEnv('ROADMAP_OFFLINE', '1');
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  expect(await load(await directory())).toEqual({status: 'unavailable'});
  const corrupt = await directory();
  await writeFile(path.join(corrupt, 'data.json'), '{');
  expect(await load(corrupt)).toEqual({status: 'unavailable'});
  expect(readRoadmap).not.toHaveBeenCalled();
});
it('keeps fresh data available when cache persistence fails', async () => {
  vi.stubEnv('ROADMAP_OFFLINE', '0');
  vi.mocked(readRoadmap).mockResolvedValue(data);
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const cache = path.join(await directory(), 'not-a-directory');
  await writeFile(cache, 'existing file');
  expect(await load(cache)).toEqual({status: 'available', data});
  expect(warn).toHaveBeenCalledWith('roadmap: could not save cache');
});
