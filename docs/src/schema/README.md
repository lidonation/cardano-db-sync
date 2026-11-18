# Schema explorer data and routes (B18)

`plugins/schema-explorer` builds one entity model from B08's `schema.json`, B09's rename map,
B12's guide locks, and `generated/schema-explorer.json`. Its `entities.json` is the build-side
integration point for B19; no filter, ranking algorithm or search UI is implemented here.

Default/core tables use `/schema/<table>`, address-only definitions use
`/schema/address/<table>`, and columns use `#column-<column>`. Shared definitions have one URL.
Former column names also resolve to their current row. The same lock declaration generates a
compact guide-to-table list and the supported current-variant inverse table-to-guide list.

## Regeneration

With a local Postgres 17 server and normal libpq environment variables:

```sh
npm run extract:explorer
npm run extract:explorer -- --check
npm run check:explorer
```

The first two commands create and drop only their uniquely named throwaway databases. They replay
stage-one domains in full, then observe every stage-two, stage-three and stage-four migration.
Column changes use B08's resolved fingerprints, not SQL-text matching. Names are normalized by the
rename map before diffing. Stage-one historical definitions are not reconstructed; pages disclose
that evidence boundary. Address-table conversion runs in B08's order and is labeled as runtime,
not assigned a fictitious migration number. SQL-enforced foreign keys and logical Haskell typed
keys are distinct evidence classes. A typed `TxId` joins to `tx`, even in `tx_in.tx_out_id`.
No relationships are guessed from `_id` spelling.

The extraction workflow checks byte-identical regeneration. The ordinary docs build is database
free, validates current fingerprints and relationship endpoints, and keeps the existing broken
link, metadata, CSP and asset-budget gates. `doc/ERD.png` was already retired by B17; it must not
return to the output.

## Browser boundary

All schema routes reuse one client module. A webpack alias exposes generated documents only to SSR;
the client alias is empty. The client retains the named SSR article during hydration. Router entry
from another surface uses ordinary browser navigation to the generated static document, not a
second fetch/parser/state layer. Full history, schema JSON and entity JSON never enter browser
bundles. Raw markup is generated from escaped artifact values; there is no remote/user HTML input.
A normal-navigation link remains available while opening the static page.

The diagrams use semantic theme tokens, intrinsic SVG dimensions, an accessible name and a longer
description, plus a linked relationship table. Generated prose is English until a translation
producer exists, so fallback pages are marked English and canonicalize to the English route.
The existing site layout is reused; later checklist work owns explorer UI chrome.
