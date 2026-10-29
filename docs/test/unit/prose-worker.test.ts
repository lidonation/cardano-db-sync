import {afterEach, describe, expect, it, vi} from 'vitest';
import {loadProseApi, searchProse} from '../../src/search/prose';

class FakeWorker {
  static latest: FakeWorker;
  handlers = new Map<string, (event: {data?: unknown}) => void>();
  messages: Array<{
    id: number;
    method: string;
    query?: string;
    options: {basePath: string; language: string};
  }> = [];
  terminate = vi.fn();
  failPost = false;
  constructor(
    readonly url: string,
    readonly options: {type: string},
  ) {
    FakeWorker.latest = this;
  }
  addEventListener(name: string, handler: (event: {data?: unknown}) => void) {
    this.handlers.set(name, handler);
  }
  postMessage(message: (typeof this.messages)[number]) {
    if (this.failPost) throw new Error('post failed');
    this.messages.push(message);
    if (message.method === 'init') this.reply({id: message.id});
  }
  reply(data: unknown) {
    this.handlers.get('message')?.({data});
  }
}

async function ready() {
  vi.stubGlobal('Worker', FakeWorker);
  vi.stubGlobal('document', {documentElement: {lang: 'ja'}});
  const api = await loadProseApi('/preview/ja/pagefind/v1/');
  await api.init();
  return {api, worker: FakeWorker.latest};
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('worker-only transport', () => {
  it('loads no engine on the page and uses an explicit locale in a same-origin module worker', async () => {
    const {api, worker} = await ready();
    expect(worker.url).toBe('/preview/ja/pagefind/_runtime/prose-worker.js');
    expect(worker.options).toEqual({type: 'module'});
    expect(worker.messages[0].options.language).toBe('ja');
    await api.init();
    expect(worker.messages).toHaveLength(1);
    const response = api.search('tx_out');
    const id = worker.messages.at(-1)!.id;
    worker.reply({id: -1});
    worker.reply({id, results: [{url: '/guide', excerpt: 'tx_out', sub_results: []}]});
    const results = await response;
    expect(await results!.results[0].data()).toEqual({
      url: '/guide',
      excerpt: 'tx_out',
      sub_results: [],
    });
    await api.destroy();
    expect(worker.terminate).toHaveBeenCalledOnce();
    await expect(api.search('offline')).rejects.toThrow('not initialized');
  });

  it.each(['error', 'messageerror'])('rejects outstanding searches on %s', async (event) => {
    const {api, worker} = await ready();
    const response = api.search('tx_out');
    worker.handlers.get(event)?.({});
    await expect(response).rejects.toThrow('Prose worker');
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it('surfaces worker errors and synchronous postMessage failures', async () => {
    const {api, worker} = await ready();
    const first = api.search('bad');
    worker.reply({id: worker.messages.at(-1)!.id, error: 'index unavailable'});
    await expect(first).rejects.toThrow('index unavailable');
    worker.failPost = true;
    await expect(api.search('bad')).rejects.toThrow('post failed');
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it('bounds a silent worker and allows a same-bundle retry after failure', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('Worker', FakeWorker);
    vi.stubGlobal('document', {documentElement: {lang: 'en'}});
    const api = await loadProseApi('/pagefind/v1/');
    const first = searchProse(api, '/pagefind/v1/', 'first');
    const failure = expect(first).rejects.toThrow('timed out');
    await vi.advanceTimersByTimeAsync(30_000);
    await failure;
    const second = searchProse(api, '/pagefind/v1/', 'retry');
    await vi.advanceTimersByTimeAsync(0);
    const worker = FakeWorker.latest;
    worker.reply({id: worker.messages.at(-1)!.id, results: []});
    await expect(second).resolves.toEqual([]);
    await api.destroy();
  });
});
