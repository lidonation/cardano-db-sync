# Numbers snapshot integration

The Numbers route reads committed data, never a browser request to a provider. The default
adapter in `data.ts` returns `unavailable` until the chain refresh and storage model publish a
snapshot. No sample figures from the design enter the production route.

`NumbersSnapshot` in `types.ts` separates provider facts from storage model output. The model
owns `databaseGB`, `monthlyCostUSD`, `tables` and `growth`; Numbers only formats those values.
The Config wizard must consume that same output when its result panel is implemented. This
route does not calculate a second model or introduce storage coefficients.

To connect the chain refresh:

- Publish separate snapshots for preview and mainnet. Use canonical UTC ISO timestamps,
  including milliseconds, for `updatedAt`, `nextBoundary` and completed epoch boundaries.
- Supply the provider name in `source`. Supply the model basis and selected configuration in
  `storage.methodology` and `storage.configuration`. Use `storage: null` if model outputs are
  unavailable. Storage sizes are decimal GB; monthly costs are USD.
- Validate the committed artifact with `numbersState(snapshot, buildNetwork, asOf)`. Pass a
  deterministic build timestamp for `asOf`, not a separate server and browser clock. Data is
  stale when `asOf` reaches `nextBoundary`; a future-dated snapshot is invalid. A wrong-network
  snapshot is never displayed.
- Keep each displayed collection to at most 12 entries. Epochs and table names are unique;
  sizes/counts cannot be negative or non-finite, table identifiers use lowercase SQL names,
  and listed table sizes cannot exceed the modelled database size.
- Replace `committedNumbersState` with the validated build input. Add a real equality test
  against the Config wizard's model consumer before considering the shared-model requirement
  complete.

The refresh workflow and provider credentials belong to the chain-data task, not this route.
The page does not claim database measurements, sync progress, rollback counts or instance
health from a public provider. Stale values retain their timestamp and warning.

Synthetic fixtures are development-only behind `DBS_INVENTORY`. They demonstrate ready,
stale, unavailable, invalid and network-mismatch states and must not appear in built routes,
route manifests, assets or bundles. Browser tests assert this separation.
