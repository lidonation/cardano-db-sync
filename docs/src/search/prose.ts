/** The browser Pagefind module is loaded only when a prose search is requested. */
export interface ProseResult {
  url: string;
  excerpt: string;
  sub_results: Array<{url: string; [key: string]: unknown}>;
  [key: string]: unknown;
}
export interface PagefindApi {
  destroy(): Promise<unknown>;
  options(options: {basePath: string; baseUrl: string}): Promise<unknown>;
  init(): Promise<unknown>;
  search(query: string): Promise<{results: Array<{data(): Promise<ProseResult>}>} | null>;
}

// Indexed permalinks already include the profile and locale prefix. Do not prepend it twice.
const RESULT_URL_ROOT = '/';

// Each API retains a selected bundle. Serialize selection and hydration so concurrent
// searches cannot terminate a worker still serving the preceding version.
let tail: Promise<unknown> = Promise.resolve();
const activeBundles = new WeakMap<PagefindApi, string>();
export function searchProse(
  api: PagefindApi,
  bundle: string,
  query: string,
): Promise<ProseResult[]> {
  const run = tail
    .catch(() => {})
    .then(async () => {
      try {
        if (activeBundles.get(api) !== bundle) {
          activeBundles.delete(api);
          await api.destroy();
          await api.options({basePath: bundle, baseUrl: RESULT_URL_ROOT});
          await api.init();
          activeBundles.set(api, bundle);
        }
        const hydrate = async (term: string): Promise<ProseResult[]> => {
          const response = await api.search(term);
          // Drain all hydration before releasing the bundle lock even when one fragment fails.
          const hydrated = await Promise.allSettled(
            (response?.results ?? []).map((result) => result.data()),
          );
          return hydrated.map((result) => {
            if (result.status === 'rejected') throw result.reason;
            return structuredClone(result.value);
          });
        };
        // For a short English question, rank documents that match both the action and
        // object by the action search. That preserves the useful action-focused excerpt.
        // Other languages, quoted syntax, and longer queries retain Pagefind semantics.
        const question =
          /^\s*how\s+(?:do|can|should)\s+(?:i|we)\s+([a-z][a-z0-9_-]{1,39})\s+([a-z0-9_][a-z0-9_-]{1,79})\s*\?\s*$/i.exec(
            query,
          );
        if (question) {
          const action = await hydrate(question[1]);
          const object = new Set((await hydrate(question[2])).map((result) => result.url));
          const matching = action.filter((result) => object.has(result.url));
          if (matching.length) return matching;
        }
        return await hydrate(query);
      } catch (error) {
        activeBundles.delete(api);
        throw error;
      }
    });
  tail = run;
  return run;
}

const adapters = new WeakMap<PagefindApi, PagefindApi>();

/** Keep external cleanup or option changes from leaving a stale active-bundle cache. */
export function proseAdapter(raw: PagefindApi): PagefindApi {
  const existing = adapters.get(raw);
  if (existing) return existing;
  const api: PagefindApi = {
    destroy() {
      activeBundles.delete(api);
      return raw.destroy();
    },
    options(options) {
      activeBundles.delete(api);
      return raw.options(options);
    },
    init: () => raw.init(),
    search: (query) => raw.search(query),
  };
  adapters.set(raw, api);
  return api;
}

/** Start the generated, same-origin module worker only when a prose query needs it. */
export async function loadProseApi(bundle: string): Promise<PagefindApi> {
  const runtime = bundle.replace(/[^/]+\/$/, '_runtime/prose-worker.js');
  let worker: Worker | undefined;
  let options = {basePath: bundle, baseUrl: RESULT_URL_ROOT};
  let nextId = 0;
  const pending = new Map<
    number,
    {
      resolve: (results: ProseResult[]) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  const stop = (error: Error) => {
    worker?.terminate();
    worker = undefined;
    for (const request of pending.values()) {
      clearTimeout(request.timer);
      request.reject(error);
    }
    pending.clear();
  };
  const request = (method: 'init' | 'search', query?: string): Promise<ProseResult[]> => {
    if (!worker) return Promise.reject(new Error('Prose worker is not initialized'));
    const id = nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => stop(new Error('Prose worker timed out')), 30_000);
      pending.set(id, {resolve, reject, timer});
      try {
        worker!.postMessage({
          id,
          method,
          query,
          options: {...options, language: document.documentElement.lang},
        });
      } catch (error) {
        stop(error instanceof Error ? error : new Error(String(error)));
      }
    });
  };
  return proseAdapter({
    async destroy() {
      stop(new Error('Prose worker destroyed'));
    },
    async options(value) {
      options = value;
    },
    async init() {
      if (worker) return;
      worker = new Worker(runtime, {type: 'module'});
      worker.addEventListener('error', () => stop(new Error('Prose worker failed to load')));
      worker.addEventListener('messageerror', () =>
        stop(new Error('Prose worker sent invalid data')),
      );
      worker.addEventListener('message', ({data}) => {
        const entry = pending.get(data.id);
        if (!entry) return;
        clearTimeout(entry.timer);
        pending.delete(data.id);
        if (data.error) entry.reject(new Error(data.error));
        else entry.resolve(data.results ?? []);
      });
      await request('init');
    },
    async search(query) {
      const results = await request('search', query);
      return {results: results.map((result) => ({data: async () => result}))};
    },
  });
}
