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

// Pagefind's module has process-wide mutable bundle state. Serialize both selection and result
// hydration so concurrent searches cannot leak results between versions.
let tail: Promise<unknown> = Promise.resolve();
export function searchProse(
  api: PagefindApi,
  bundle: string,
  query: string,
): Promise<ProseResult[]> {
  const run = tail
    .catch(() => {})
    .then(async () => {
      await api.destroy();
      await api.options({basePath: bundle, baseUrl: RESULT_URL_ROOT});
      await api.init();
      const response = await api.search(query);
      return Promise.all((response?.results ?? []).map((result) => result.data()));
    });
  tail = run;
  return run;
}

/** Import the generated runtime only in response to a search, not on page load. */
export async function loadProseApi(bundle: string): Promise<PagefindApi> {
  const runtime = bundle.replace(/[^/]+\/$/, '_runtime/pagefind.js');
  return import(/* webpackIgnore: true */ runtime) as Promise<PagefindApi>;
}
