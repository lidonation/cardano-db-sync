import {describe, expect, it} from 'vitest';
import fixture from '../fixtures/roadmap/source.json';
import {transform, resolveRoadmap} from '../../plugins/roadmap/data';

describe('roadmap source', () => {
  it('aggregates the complete recorded public board without unlabelled objectives', () => {
    const data = transform(fixture.fields, fixture.pages, '2026-10-29T00:00:00.000Z');
    expect(data.statuses).toEqual({todo: 3, inProgress: 1, done: 104});
    expect(data.objectives).toEqual(
      expect.arrayContaining([
        {name: 'Sync speed', done: 11, total: 12},
        {name: 'Memory', done: 5, total: 5},
        {name: 'Modularity', done: 4, total: 4},
        {name: 'Disk space', done: 1, total: 1},
      ]),
    );
    expect(data.objectives).toHaveLength(4);
    expect(data.releases).toContain('14.0.0.0');
  });
  it('rejects incomplete, duplicate, malformed and inconsistent pages', () => {
    const bad = structuredClone(fixture.pages);
    bad[1].nodes.pop();
    expect(() => transform(fixture.fields, bad, '2026-10-29T00:00:00.000Z')).toThrow();
    const duplicate = structuredClone(fixture.pages);
    duplicate[1].nodes[0].id = duplicate[0].nodes[0].id;
    expect(() => transform(fixture.fields, duplicate, '2026-10-29T00:00:00.000Z')).toThrow();
    expect(() => transform([], fixture.pages, '2026-10-29T00:00:00.000Z')).toThrow();
  });
  it('falls back to cache or explicitly unavailable on failure', async () => {
    const data = transform(fixture.fields, fixture.pages, '2026-10-29T00:00:00.000Z');
    const fail = async () => {
      throw new Error('offline');
    };
    expect(await resolveRoadmap(fail, async () => data)).toEqual({status: 'available', data});
    expect(await resolveRoadmap(fail, fail)).toEqual({status: 'unavailable'});
  });
});

describe('public retrieval and cache validation', () => {
  it('paginates anonymously and rejects a repeated cursor or a failed page', async () => {
    const {readPages} = await import('../../plugins/roadmap/source');
    const calls: string[] = [];
    const sender = async (url: string | URL | Request) => {
      calls.push(String(url));
      return new Response(JSON.stringify(fixture.pages[calls.length - 1]), {status: 200});
    };
    expect(await readPages(sender as typeof fetch)).toHaveLength(2);
    expect(calls[1]).toContain('after=');
    const fail = async () => new Response('unavailable', {status: 503});
    await expect(readPages(fail as typeof fetch)).rejects.toThrow();
    const repeated = async () => new Response(JSON.stringify(fixture.pages[0]), {status: 200});
    await expect(readPages(repeated as typeof fetch)).rejects.toThrow('Invalid cursor');
  });
  it('rejects inconsistent cached totals and malformed data', async () => {
    const {parseCache} = await import('../../plugins/roadmap/cache');
    const data = transform(fixture.fields, fixture.pages, '2026-10-29T00:00:00.000Z');
    expect(parseCache(JSON.stringify(data))).toEqual(data);
    expect(() => parseCache('{')).toThrow();
    expect(() =>
      parseCache(JSON.stringify({...data, objectives: [{name: 'bad', done: 2, total: 1}]})),
    ).toThrow();
  });
});

it.skipIf(!process.env.ROADMAP_LIVE)(
  'reads the live public project without credentials',
  async () => {
    const {readRoadmap} = await import('../../plugins/roadmap/source');
    const data = await readRoadmap();
    expect(data.statuses.todo + data.statuses.inProgress + data.statuses.done).toBeGreaterThan(0);
  },
);
