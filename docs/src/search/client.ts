import {loadEntityIndex, searchEntities, groupEntityHits} from './engine';
import {versionSegment} from './version';
import type {EntityBundle, EntityManifest} from './entities';

type FetchJson = (
  url: string,
  init?: RequestInit,
) => Promise<{ok: boolean; json(): Promise<unknown>}>;
/** Instantiate per profile/locale. The eventual search UI imports this module lazily. */
export function createEntitySearch(baseUrl: string, locale: string, fetcher: FetchJson = fetch) {
  if (!baseUrl.startsWith('/') || baseUrl.startsWith('//') || !baseUrl.endsWith('/'))
    throw new Error('Entity base URL must be a local absolute directory');
  let manifest: Promise<EntityManifest> | undefined;
  const indexes = new Map<string, Promise<ReturnType<typeof loadEntityIndex>>>();
  async function json(file: string, cache: RequestCache): Promise<unknown> {
    const response = await fetcher(baseUrl + file, {cache, signal: AbortSignal.timeout(15_000)});
    if (!response.ok) throw new Error('Entity index fetch failed');
    return response.json();
  }
  function getManifest(): Promise<EntityManifest> {
    if (!manifest)
      manifest = json('entities/manifest.json', 'no-cache')
        .then((value) => {
          const data = value as EntityManifest;
          if (
            !data ||
            data.schemaVersion !== 1 ||
            data.locale !== locale ||
            !data.bundles ||
            typeof data.bundles !== 'object' ||
            Array.isArray(data.bundles) ||
            !Object.entries(data.bundles).every(
              ([line, file]) =>
                /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(line) &&
                typeof file === 'string' &&
                file.startsWith(`entities/${line}.`) &&
                /^entities\/[A-Za-z0-9._-]+\.[a-f0-9]{64}\.json$/.test(file),
            )
          )
            throw new Error('Invalid entity manifest');
          return data;
        })
        .catch((error) => {
          manifest = undefined;
          throw error;
        });
    return manifest;
  }
  function load(line: string, file: string) {
    let index = indexes.get(file);
    if (!index) {
      index = json(file, 'default')
        .then((value) => {
          const data = value as EntityBundle;
          if (
            !data ||
            data.schemaVersion !== 1 ||
            data.line !== line ||
            data.locale !== locale ||
            !data.index
          )
            throw new Error('Entity bundle identity mismatch');
          return loadEntityIndex(JSON.stringify(data.index));
        })
        .catch((error) => {
          indexes.delete(file);
          throw error;
        });
      indexes.set(file, index);
    }
    return index;
  }
  return {
    async search(
      line: string,
      query: string,
      {widen = false, cap = 5}: {widen?: boolean; cap?: number} = {},
    ) {
      versionSegment(line);
      // Validate cap even when the query is empty, without making a network request.
      const empty = groupEntityHits([], cap);
      if (!query.trim()) return empty;
      const data = await getManifest();
      if (!Object.hasOwn(data.bundles, line)) throw new Error(`Unknown entity version: ${line}`);
      const lines = widen
        ? [
            line,
            ...Object.keys(data.bundles)
              .filter((name) => name !== line)
              .sort(),
          ]
        : [line];
      const results = await Promise.all(
        lines.map(async (name) =>
          searchEntities(await load(name, data.bundles[name]), name, query, Infinity).flatMap(
            (group) => group.hits,
          ),
        ),
      );
      return groupEntityHits(results.flat(), cap);
    },
  };
}
