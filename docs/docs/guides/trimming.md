---
title: Trimming with tx_out modes
description: Choose an output-retention mode deliberately and verify its consequences.
requires:
  tables: [tx_in, tx_out]
  columns: [tx_out.consumed_by_tx_id]
  config: [insert_options.tx_out.value, insert_options.tx_out.force_tx_in, insert_options.ledger]
---

# Trimming with tx_out modes

Output retention trades historical detail for storage. Choose the mode before relying on a
particular query or changing an existing database. This guide summarizes the operational choices;
check the reference and release notes for the exact version you run.

> [!WARNING]
> Pruning deletes spent outputs and dependent data. You cannot recover that history merely by
> changing the setting back. Stop db-sync and take a verified, restorable database and matching
> ledger-state backup before any change. Once pruning has been enabled, keep it enabled on later
> runs unless a release-specific migration plan explicitly says otherwise.

## Prerequisites

Have a working db-sync and node on the same network, access to the db-sync JSON configuration,
and a database backup. Inventory the applications and SQL queries that require spent outputs or
transaction inputs; test the chosen configuration on an isolated copy first.

## Choose a mode

The `insert_options.tx_out.value` setting supports:

- `enable`: retain inputs and outputs.
- `disable`: do not populate input and output tables; some other derived values are incomplete.
- `consumed`: populate `tx_out.consumed_by_tx_id` so a query can distinguish spent outputs.
- `prune`: periodically delete consumed outputs and dependent multi-asset output rows.
- `bootstrap`: defer bulk insertion of unspent outputs until near the tip, then use a pruned
  representation. The documented initial implementation requires an enabled ledger and a
  Babbage or Conway network.

`insert_options.tx_out.force_tx_in` can preserve input rows for `consumed`, `prune`, and
`bootstrap`; it does not make pruned output history reappear. It is ignored for `enable` and
`disable`. Presets may override individual settings: inspect the effective configuration rather
than assuming this fragment takes precedence.

For example, this is an **insert_options fragment**, not a complete configuration file:

```json
{
  "tx_out": {
    "value": "consumed",
    "force_tx_in": true
  }
}
```

Stop db-sync, edit the existing configuration using a JSON-aware editor, validate the complete
file and restart using your deployment's normal procedure. Do not replace the entire configuration
with the fragment above. Follow the release's documented migration and compatibility rules when
changing an already-populated database.

## Verify and recover

Confirm the effective setting in startup logs without disclosing secrets, and verify the schema
and representative application queries against the isolated copy. `tx_out` and `tx_in` contents
will differ by mode and sync progress; a running process does not prove a complete history.
If results are unexpected, stop the service and investigate. Restore the matching verified backup
or resynchronize as directed by the release documentation rather than assuming a setting reversal
will reconstruct deleted rows.
