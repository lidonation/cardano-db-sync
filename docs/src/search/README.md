# Entity search data (B19)

The build-only `plugins/entity-search` consumes B18's `entityIndex` function (the same model that
writes `entities.json`), B12 guide locks, the extracted config tree and CLI annotations, and the
Docusaurus default docs plugin's loaded versions. No database or Haskell tools run in site builds.

Each locale emits `entities/manifest.json` and `entities/<line>.<sha256>.json`. The hash covers the
entire UTF-8 payload, including its locale and line, with no build clock or git revision. Records
are inserted in stable ID order. A normal build recreates the directory so stale bundles cannot
mask drift. Deploy the manifest and payloads together. The manifest is revalidated on first search;
content-addressed bundles may be cached. No entity JSON or MiniSearch runtime enters site chrome.

`createEntitySearch(baseUrl, locale)` is the browser-free adapter for the later search UI. Import
it lazily when search opens; pass the active Docusaurus profile/locale base URL (trailing slash),
then call `search(line, query)`. The default is that line only. `{widen: true}` explicitly searches
all loaded lines; `{cap: Infinity}` supplies the group's show-all action. Results always include
`tables`, `guides`, `docs` groups with `total` and `hasMore`, even when empty. Fetch, parse and
identity errors reject rather than silently substituting a different version or an empty result;
a later search can retry. An empty query makes no network request. The UI owns loading/error
states, labels, focus and rendering; this change does not add a modal or alter Pagefind.

MiniSearch 7.2.0 indexes whole identifiers and underscore/CamelCase parts without stemming.
Queries split at identifier boundaries so `txOut`, `tx_out`, `tx out` and partial prefixes can
reach the same entity. Exact identifiers/aliases, identifier prefixes, titles, then descriptions
are separate ranking tiers; MiniSearch scores only order within a tier. Equal scores are resolved
by kind, core variant, then stable ID. Widening preserves active-line precedence on equal ranks.
Full guide bodies remain Pagefind's responsibility: Tier 1 carries descriptions, not duplicate prose.

## Evidence boundaries

- Current schema routes and column anchors come from the explorer. No historical schema is
  published yet, so older bundles contain their actual loaded documents only, never current
  tables/config/CLI masquerading as historical data. Version fixtures exercise multiple lines.
- Guide range/variant facets come from locks, and unavailable guides are excluded. Locale titles
  and descriptions come from Docusaurus, including its honest English fallback where untranslated.
- Config entities are canonical extracted keys declared by a published guide. CLI entities are
  extracted, explicitly annotated current flags mentioned as whole flags in a published guide.
  Their destination is that guide, not an invented reference page. Keys/flags with no published
  destination remain unindexed until their reference surface exists.
- Facets are typed numbers, booleans and identifiers, never translated strings. Column counts,
  variants, ownership and nullability are supported. The artifacts do not provide SQL index
  evidence: `indexed` is deliberately absent rather than inferred from an `_id` spelling or a
  typed relationship. A future extractor may supply it without changing the wire contract.

## Verification

Run `npm test -- --maxWorkers=6` for tokenizer, ranking, aliases, scoped fetch/error contracts,
canonical-source facets, deterministic emission and plugin integration. `npm run test:build`
checks both profiles and all launch locales against the emitted manifest/hash and real destinations.
There are no new environment variables, secrets, jobs or deployment steps.
