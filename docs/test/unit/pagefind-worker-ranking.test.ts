import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {expect, it, vi} from 'vitest';

function makeWorker(search: (query: string) => Promise<unknown>) {
  const send = vi.fn();
  let listener: (event: {data: unknown}) => Promise<void> = async () => {};
  const self = {
    addEventListener: (_event: string, fn: typeof listener) => {
      listener = fn;
    },
    postMessage: send,
  };
  const source = readFileSync('plugins/pagefind-prose/worker.mjs', 'utf8').replace(
    "import {createInstance} from './pagefind.js';",
    '',
  );
  runInNewContext(source, {
    self,
    structuredClone,
    createInstance: () => ({init: async () => {}, search}),
  });
  return {send, call: async (data: object) => listener({data})};
}

it('ranks documents matching both terms with the action excerpt', async () => {
  const item = (url: string, excerpt: string) => ({data: async () => ({url, excerpt})});
  const search = vi.fn(async (q: string) => ({
    results:
      q === 'prune'
        ? [item('/trim', 'prune outputs'), item('/other', 'pruned')]
        : [item('/trim', 'tx_out'), item('/queries', 'tx_out')],
  }));
  const worker = makeWorker(search);
  await worker.call({id: 1, method: 'init', options: {}});
  await worker.call({id: 2, method: 'search', query: 'how do I prune tx_out?'});
  expect(worker.send).toHaveBeenLastCalledWith({
    id: 2,
    results: [{url: '/trim', excerpt: 'prune outputs'}],
  });
  expect(search.mock.calls.map(([q]) => q)).toEqual(['prune', 'tx_out']);
});

it('preserves ordinary queries and falls back when the intersection is empty', async () => {
  const search = vi.fn(async (q: string) => ({
    results: q === 'prune' || q === 'tx_out' ? [] : [{data: async () => ({url: '/fallback'})}],
  }));
  const worker = makeWorker(search);
  await worker.call({id: 1, method: 'init', options: {}});
  await worker.call({id: 2, method: 'search', query: 'how can we prune tx_out?'});
  await worker.call({id: 3, method: 'search', query: '"how do I prune tx_out?"'});
  expect(search.mock.calls.map(([q]) => q)).toEqual([
    'prune',
    'tx_out',
    'how can we prune tx_out?',
    '"how do I prune tx_out?"',
  ]);
  expect(worker.send).toHaveBeenLastCalledWith({id: 3, results: [{url: '/fallback'}]});
});

it('reports lookup failures rather than returning partial results', async () => {
  const worker = makeWorker(async (q) => {
    if (q === 'tx_out') throw new Error('object lookup failed');
    return {results: []};
  });
  await worker.call({id: 1, method: 'init', options: {}});
  await worker.call({id: 2, method: 'search', query: 'how do I prune tx_out?'});
  expect(worker.send).toHaveBeenLastCalledWith({id: 2, error: 'Error: object lookup failed'});
});

it('retains the action excerpt when the next lookup mutates a cached fragment', async () => {
  const fragment = {url: '/trim', excerpt: 'prune outputs'};
  const search = async (q: string) => {
    if (q === 'tx_out') fragment.excerpt = 'tx_out results';
    return {results: [{data: async () => fragment}]};
  };
  const worker = makeWorker(search);
  await worker.call({id: 1, method: 'init', options: {}});
  await worker.call({id: 2, method: 'search', query: 'how do I prune tx_out?'});
  expect(worker.send).toHaveBeenLastCalledWith({
    id: 2,
    results: [{url: '/trim', excerpt: 'prune outputs'}],
  });
});
