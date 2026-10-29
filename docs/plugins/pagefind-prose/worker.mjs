/* global self */
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
      const response = await api.search(query);
      const hydrated = await Promise.allSettled(response.results.map((result) => result.data()));
      const results = hydrated.map((result) => {
        if (result.status === 'rejected') throw result.reason;
        return result.value;
      });
      self.postMessage({id, results});
    } else {
      throw new Error(`Unknown prose worker method: ${method}`);
    }
  } catch (error) {
    self.postMessage({id, error: String(error)});
  }
});
