# One capacity model, two consumers (B23)

`model.mjs` is the only storage/cost formula. The cron stores its full-configuration output in
`generated/chain-{preview,mainnet}.json`. Numbers displays it unchanged. B33's Config · 6 panel
calls `wizardStorageState` with the same validated snapshot and the actual B10 config fragment.
The adapter returns `MODELLED ESTIMATES`, methodology, configuration and original timestamp
alongside the values; the panel must render all of them and preserve the `stale` warning.
The wizard UI itself remains B33, not a second implementation in this data-layer task.

## Model v1 — deliberately uncalibrated

This is an illustrative capacity-planning model, not a database measurement or a price quote.
No empirical calibration against a self-hosted instance has been claimed. A public chain API
cannot measure Postgres table sizes. Provider facts and estimates remain separate in
`NumbersSnapshot`; `transactions` is the **current epoch's** measured count, never a fabricated
lifetime counter.

For historical volume, use chain height × the transaction/block ratio in up to twelve completed
epochs. This extrapolation is **modelled**, not a lifetime transaction measurement. Zero usable
sample blocks means no model, not invented coefficients for chain activity. Per-epoch growth
uses that epoch's provider block and transaction counts, not a subtraction of rounded totals.

The assumed bytes below are per block, transaction or epoch, **before** the common 2× index and
headroom factor. Sizes are decimal GB. Allocations cover representative relations, not every
table. The model excludes WAL, backups, ledger state, replication and host compute/memory.

| Relation              | Assumption                                                            |
| --------------------- | --------------------------------------------------------------------- |
| `block`               | 512 bytes/block                                                       |
| `tx`                  | 512 bytes/transaction                                                 |
| `tx_out`              | 2 outputs/transaction × 256 bytes, if enabled                         |
| `tx_in`               | 2 inputs/transaction × 128 bytes, if outputs or forced inputs enabled |
| `tx_metadata`         | 256 bytes/transaction, if enabled                                     |
| `multi_asset`         | 128 bytes/transaction, if enabled                                     |
| `redeemer`            | 512 bytes/transaction, if Plutus enabled                              |
| `delegation`          | 64 bytes/transaction, if Shelley enabled                              |
| `gov_action_proposal` | 32 bytes/transaction, if governance enabled                           |
| `epoch`               | 4096 bytes/epoch, unless epoch insertion disabled                     |

Prune/bootstrap retain an assumed 10% of output allocation; this is **not** an observed UTxO
ratio. Options and overrides resolve from B10's extracted defaults/presets, including the
binary's null-means-default semantics. Row filters (metadata keys, policies, addresses, script
hashes), alternative address layout and stop-at-block are not modelled; enabled relations are
estimated as unfiltered full-history allocations. The visible methodology states this limitation.
Do not use this model to promise disk capacity for a specific deployment.

Monthly cost = modelled GB × **0.10 USD/GB/month**, an assumed storage-only unit rate, not a
cloud-provider tariff or the price of running db-sync. A current-epoch snapshot with an old model
basis is refreshed rather than skipped. The wizard refuses mismatched saved/current model output
until that refresh, preventing two consumers from showing different bases.

Change/calibrate the model in this one module, not in either consumer, and bump its visible
version when the basis changes.

## Refresh contract

- Blockfrost's documented [latest block](https://docs.blockfrost.io/#tag/Cardano-Blocks/paths/~1blocks~1latest/get),
  [epoch](https://docs.blockfrost.io/#tag/Cardano-Epochs/paths/~1epochs~1{number}/get) and previous-epoch
  endpoints provide the public facts. Pin both epoch reads to the latest block's epoch to avoid
  mixing data across a boundary. No instance health, rollback count or sync percentage is inferred.
- Epoch boundaries derive from network genesis: preview Unix 1666656000 with 86400 seconds per
  epoch; mainnet Unix 1506203091 with 432000 seconds. The anchors and durations match the
  [published network genesis files](https://book.world.dev.cardano.org/environments/)
  (preview Shelley systemStart; mainnet Byron startTime and Shelley epochLength/slotLength).
  Reject a provider tip outside the current
  network epoch, malformed counts, noncontiguous history and impossible block totals.
- Every configured network makes at most three requests per refresh (two at genesis), with a
  15-second timeout and a one-MB response limit each, no redirects and no retries. An hourly
  default-branch schedule skips requests while the saved snapshot is still current. This is
  about 18 mainnet + 90 preview requests/month, not the spec's illustrative one-call figure;
  it remains comfortably inside Blockfrost's free request allowance.
- Missing keys make no requests and do not erase data. Provider failure cannot replace a valid
  snapshot. A validated success is formatted deterministically and atomically renamed into place.
  Identical provider inputs and `now` produce identical bytes. Production timestamps request
  completion, so a newly minted block cannot be rejected against an older request-start clock.
- Build plugins read only these committed files. Initial `null` artifacts deliberately mean
  unavailable; no synthetic numbers are seeded into production. Neither a site build nor a browser
  needs provider keys. SSR/hydration starts with one build-time state across locales; after
  hydration the shared Numbers hook checks expiry and warns at the boundary even if a failed cron
  never produces another site build. B33 should use that same hook before calling its adapter.

Tests cover model/consumer equality, preset effects, bounded acquisition, missing/bad data,
network isolation, atomic retention, deterministic bytes, real no-key HTML/hydration and
browser expiry without provider requests. A live provider comparison still needs a human with
configured keys; it cannot calibrate the illustrative Postgres assumptions by itself.

## Local verification

Run the commands in `package.json`'s `verify` script in their listed order. To bound a local run,
pass `--maxWorkers=6` to the unit Vitest command and `--workers=6` to `test:components`; retain the
other Playwright configurations' stricter worker limits. `test:build` is deliberately serial.
Do not overlap Docusaurus builds/dev servers in one working tree: they share generated state.
The populated-snapshot expiry test waits for the real hydration chunk before advancing the
browser clock, so its jump cannot expire webpack's in-flight chunk timer instead.
