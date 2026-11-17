# Numbers snapshot integration

Numbers reads the committed `generated/chain-{preview,mainnet}.json` artifact through the
`chain-data` build plugin. Builds and browsers never query the provider or need provider keys.
Initial `null` files deliberately render the named unavailable state; malformed, future-dated
and wrong-network snapshots fail closed. The public snapshot validator is `snapshot.mjs`,
re-exported by `data.ts` for typed consumers and reused by the Node refresh command.

`NumbersSnapshot` separates provider facts from model output. `transactions` is the **current
epoch's** transaction count. The model owns `databaseGB`, `monthlyCostUSD`, `tables` and
`growth`; Numbers only formats those values. The [shared storage model](../storage/README.md)
documents its assumptions and the B33 wizard adapter. Both consumers must show the
`MODELLED ESTIMATES` label, methodology, selected configuration and original update timestamp.
Neither presents modelled data as instance measurements.

`useCommittedNumbersState` hydrates the exact build state, then checks expiry after hydration,
at the next boundary and when visibility changes. Stale data retains its timestamp, values and
warning even when a cron failure prevents a new build. No provider request occurs in the hook.
The wizard panel should use this same hook, then pass its state and config fragment to
`wizardStorageState`. No independent clock or storage formula belongs in that panel.

Each collection contains at most twelve entries. Epochs and table names are unique; counts and
sizes are finite and nonnegative. SQL identifiers are bounded lowercase names, and listed table
sizes cannot exceed total modelled GB. Timestamps are canonical UTC ISO with milliseconds;
freshness expires at the snapshot's network-derived `nextBoundary`.

Synthetic fixtures remain development-only behind `DBS_INVENTORY`. They must never appear in
built routes, route manifests, assets or bundles. The real-snapshot build test temporarily
installs a generated test artifact, verifies SSR/hydration/expiry, then restores the committed
empty artifact and removes its output. Restart the development server after changing a committed
snapshot; each build deliberately holds one immutable state across locales.
