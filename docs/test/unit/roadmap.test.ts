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
    const fields = structuredClone(fixture.fields);
    fields.find((field) => field.name === 'Release Planned')!.settings.options[0].name =
      'invalid release';
    expect(() => transform(fields, fixture.pages, '2026-10-29T00:00:00.000Z')).toThrow();
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
      parseCache(JSON.stringify({...data, statuses: {...data.statuses, todo: 100, done: 10}})),
    ).toThrow();
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

it('rejects seeded missing-field mutations across the complete snapshot', () => {
  let seed = 123456789;
  for (let i = 0; i < 60; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const pages = structuredClone(fixture.pages);
    const page = seed % pages.length;
    const index = (seed >>> 8) % pages[page].nodes.length;
    pages[page].nodes[index].memexProjectColumnValues = [];
    expect(() => transform(fixture.fields, pages, '2026-10-29T00:00:00.000Z')).toThrow();
  }
});

it('rejects a changed board format before accepting source data', async () => {
  const {readRoadmap} = await import('../../plugins/roadmap/source');
  const send = async () => new Response('<html>format changed</html>', {status: 200});
  await expect(readRoadmap(send as typeof fetch)).rejects.toThrow('Board format changed');
});

it('applies one deadline across the board and all pages without sending credentials', async () => {
  const {readRoadmap} = await import('../../plugins/roadmap/source');
  const {vi} = await import('vitest');
  const deadlines: number[] = [];
  const timeout = vi.spyOn(AbortSignal, 'timeout').mockImplementation((milliseconds) => {
    deadlines.push(milliseconds);
    return new AbortController().signal;
  });
  const groups = [
    ['_noValue', 3],
    ['Blocked', 0],
    ['In Progress', 1],
    ['Done', 104],
    ['Released', 0],
  ];
  const board = `<script id="memex-paginated-items-get-api-data">${JSON.stringify({url: '/memexes/6909988/paginated_items'})}</script>
    <script id="memex-columns-data">${JSON.stringify(fixture.fields)}</script>
    <script id="memex-paginated-items-data">${JSON.stringify({totalCount: {value: 108, isApproximate: false}, groups: {nodes: groups.map(([groupValue, value]) => ({groupValue, totalCount: {value, isApproximate: false}}))}})}</script>`;
  let call = 0;
  try {
    const send: typeof fetch = async (_url, init) => {
      expect(init?.headers).toEqual({accept: call === 0 ? 'text/html' : 'application/json'});
      expect(init?.redirect).toBe('error');
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      return new Response(call++ === 0 ? board : JSON.stringify(fixture.pages[call - 2]));
    };
    const result = await readRoadmap(send);
    expect(result.statuses).toEqual({todo: 3, inProgress: 1, done: 104});
    expect(call).toBe(3);
    // One snapshot-wide deadline, not a fresh minute for every page.
    expect(deadlines.filter((value) => value === 60_000)).toHaveLength(1);
  } finally {
    timeout.mockRestore();
  }
});

it('rejects oversized source bodies and falls back to the validated snapshot', async () => {
  const {readRoadmap} = await import('../../plugins/roadmap/source');
  const data = transform(fixture.fields, fixture.pages, '2026-10-29T00:00:00.000Z');
  const send: typeof fetch = async () => new Response(' '.repeat(5 * 1024 * 1024 + 1));
  await expect(readRoadmap(send)).rejects.toThrow('Roadmap response exceeds size limit');
  expect(
    await resolveRoadmap(
      () => readRoadmap(send),
      async () => data,
    ),
  ).toEqual({status: 'available', data});
});

it('stops pagination when the shared deadline expires and preserves cache fallback', async () => {
  const {readPages} = await import('../../plugins/roadmap/source');
  const controller = new AbortController();
  const data = transform(fixture.fields, fixture.pages, '2026-10-29T00:00:00.000Z');
  let calls = 0;
  const send: typeof fetch = async (_url, init) => {
    if (++calls === 2) controller.abort(new Error('snapshot deadline'));
    expect(init?.signal?.aborted).toBe(calls === 2);
    return new Response(JSON.stringify(fixture.pages[calls - 1]));
  };
  const fresh = async () => {
    await readPages(send, {signal: controller.signal, remainingBytes: 20 * 1024 * 1024});
    return data;
  };
  expect(await resolveRoadmap(fresh, async () => data)).toEqual({status: 'available', data});
  expect(calls).toBe(2);
});

it('cancels a chunked oversized body before reading the rest', async () => {
  const {readPages} = await import('../../plugins/roadmap/source');
  let cancelled = false;
  let chunks = 0;
  const send: typeof fetch = async () =>
    new Response(
      new ReadableStream({
        pull(controller) {
          chunks++;
          controller.enqueue(new Uint8Array(2 * 1024 * 1024));
        },
        cancel() {
          cancelled = true;
        },
      }),
    );
  await expect(readPages(send)).rejects.toThrow('Roadmap response exceeds size limit');
  expect(cancelled).toBe(true);
  // Streams may prefetch one chunk; no more than 8 MiB is ever consumed or queued.
  expect(chunks).toBeLessThanOrEqual(4);
});

it('limits the cumulative bytes across otherwise individually small pages', async () => {
  const {readPages} = await import('../../plugins/roadmap/source');
  let calls = 0;
  const send: typeof fetch = async () =>
    new Response(
      JSON.stringify({
        pageInfo: {hasNextPage: true, endCursor: String(++calls)},
        padding: ' '.repeat(1024 * 1024),
      }),
    );
  await expect(readPages(send)).rejects.toThrow('Roadmap response exceeds size limit');
  expect(calls).toBe(20);
});
