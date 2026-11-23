import MiniSearch from 'minisearch';
import type {EntityHit, EntityResults, SearchEntity} from './entities';

const normalize = (text: string): string => text.normalize('NFKC').toLowerCase().trim();
/** Split only at identifier boundaries, never stem prune/pruned or translate names. */
function parts(text: string): string[] {
  return text
    .normalize('NFKC')
    .replace(/(\p{Lu})(\p{Lu}\p{Ll})/gu, '$1 $2')
    .replace(/([\p{Ll}\p{N}])(\p{Lu})/gu, '$1 $2')
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .map(normalize);
}
/** Index both whole and split forms; query parts also bridge txOut and tx_out. */
export function tokenize(text: string): string[] {
  const whole = text.normalize('NFKC').match(/[\p{L}\p{N}_]+/gu) ?? [];
  return [...new Set(whole.flatMap((word) => [normalize(word), ...parts(word)]))];
}
function rank(record: SearchEntity, query: string, terms: string[]): number {
  const names = [record.identifier, ...record.aliases].filter(Boolean);
  if (names.some((name) => normalize(name) === query)) return 0;
  const matches = (name: string) =>
    terms.every((term) => tokenize(name).some((token) => token.startsWith(term)));
  if (names.some(matches)) return 1;
  if (matches(record.title)) return 2;
  return 3;
}
const options = {
  fields: ['identifier', 'aliases', 'title', 'body'],
  storeFields: ['kind', 'group', 'identifier', 'aliases', 'title', 'url', 'facets'],
  tokenize,
  processTerm: (term: string) => normalize(term),
};
export function createEntityIndex(records: readonly SearchEntity[]): MiniSearch<SearchEntity> {
  const index = new MiniSearch<SearchEntity>(options);
  // Stable insertion order also makes the serialized inverted index byte-identical.
  index.addAll([...records].sort((a, b) => compare(a.id, b.id)));
  return index;
}
export function loadEntityIndex(json: string): MiniSearch<SearchEntity> {
  return MiniSearch.loadJSON<SearchEntity>(json, options);
}
const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Explicit lexical tiers dominate MiniSearch's within-tier relevance score. */
export function searchEntities(
  index: MiniSearch<SearchEntity>,
  line: string,
  query: string,
  cap = 5,
): EntityResults[] {
  if (cap !== Infinity && (!Number.isInteger(cap) || cap < 1)) throw new Error('Invalid group cap');
  const normalized = normalize(query),
    terms = parts(query);
  const hits: EntityHit[] = terms.length
    ? index
        .search(query, {
          tokenize: parts,
          prefix: true,
          fuzzy: false,
          combineWith: 'AND',
          boost: {identifier: 8, aliases: 8, title: 2, body: 1},
        })
        .map((result) => {
          const record = result as unknown as SearchEntity;
          const tier = rank(record, normalized, terms);
          return {
            ...structuredClone({
              id: String(result.id),
              kind: record.kind,
              group: record.group,
              identifier: record.identifier,
              aliases: record.aliases,
              title: record.title,
              url: record.url,
              facets: record.facets,
            }),
            line,
            score: result.score,
            tier,
          };
        })
        .sort(
          (a, b) =>
            a.tier - b.tier ||
            b.score - a.score ||
            Number(b.kind === 'table') - Number(a.kind === 'table') ||
            Number(b.facets.variants?.includes('core') ?? false) -
              Number(a.facets.variants?.includes('core') ?? false) ||
            compare(a.id, b.id),
        )
    : [];
  return groupEntityHits(hits, cap);
}
/** Stable sort retains active-line precedence on equal ranks when widening. */
export function groupEntityHits(hits: EntityHit[], cap = 5): EntityResults[] {
  if (cap !== Infinity && (!Number.isInteger(cap) || cap < 1)) throw new Error('Invalid group cap');
  const sorted = hits.slice().sort((a, b) => a.tier - b.tier || b.score - a.score);
  return (['tables', 'guides', 'docs'] as const).map((group) => {
    const matches = sorted.filter((hit) => hit.group === group);
    return {
      group,
      hits: matches.slice(0, cap),
      total: matches.length,
      hasMore: matches.length > cap,
    };
  });
}
