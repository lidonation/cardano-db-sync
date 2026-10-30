/* global self, structuredClone */
// A module worker uses Pagefind's public instance API. It needs no second copy of the engine
// for main-thread fallback, which cannot compile WASM under the site's strict page CSP anyway.
import {createInstance} from './pagefind.js';

let api;
self.addEventListener('message', async ({data: {id, method, options, query}}) => {
  try {
    if (method === 'init') {
      api = createInstance(options);
      await api.init();
      self.postMessage({id});
    } else if (method === 'search') {
      const hydrate = async (term) => {
        const response = await api.search(term);
        const hydrated = await Promise.allSettled(
          (response?.results ?? []).map((result) => result.data()),
        );
        return hydrated.map((result) => {
          if (result.status === 'rejected') throw result.reason;
          return structuredClone(result.value);
        });
      };
      // For short English questions, intersect action and object matches while keeping the
      // action excerpt. Other query forms retain Pagefind semantics.
      const question =
        /^\s*how\s+(?:do|can|should)\s+(?:i|we)\s+([a-z][a-z0-9_-]{1,39})\s+([a-z0-9_][a-z0-9_-]{1,79})\s*\?\s*$/i.exec(
          query,
        );
      let results;
      if (question) {
        const action = await hydrate(question[1]);
        const object = new Set((await hydrate(question[2])).map((result) => result.url));
        results = action.filter((result) => object.has(result.url));
      }
      if (!results?.length) results = await hydrate(query);
      self.postMessage({id, results});
    } else {
      throw new Error(`Unknown prose worker method: ${method}`);
    }
  } catch (error) {
    self.postMessage({id, error: String(error)});
  }
});
