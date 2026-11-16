---
title: Runtime option migration
description: Replace retired runtime options and validate configuration before restarting db-sync.
requires:
  tables:
    - address
    - script
    - tx_cbor
    - tx_out
    - multi_asset
    - pool_stat
  columns: []
  config:
    - insert_options.tx_out.value
    - insert_options.remove_jsonb_from_schema
    - insert_options
    - insert_options.tx_cbor
    - insert_options.tx_out
    - insert_options.ledger
    - insert_options.shelley
    - insert_options.multi_asset
    - insert_options.metadata
    - insert_options.plutus
    - insert_options.governance
    - insert_options.offchain_pool_data
    - insert_options.offchain_vote_data
    - insert_options.disable_epoch
    - insert_options.preset
    - insert_options.tx_out.use_address_table
    - insert_options.pool_stat
---

# Runtime option migration

`insert_options.json_type is retired` is a startup error, including for `text`, `jsonb`
and `disable`. Remove that key. Use `remove_jsonb_from_schema` to choose text columns
(`enable`) or JSONB columns (`disable`, the default); JSON payload insertion is not
independently disabled. Conversion of an existing schema runs at startup and can take time.

The retired `--disable-in-out` switch is also rejected before startup. Set
`insert_options.tx_out.value` to `disable` instead, including when migrating a command
that supplied both the switch and explicit output settings.

Set stake-address, policy and script selections before syncing a fresh database. The same
selections, regardless of ordering or duplicates, can be used on restart. Adding, changing
or removing a selection on a populated database requires a fresh database and replay.
Do not run older db-sync binaries against a selectively indexed database: they do not
enforce the selections.

## Recommended insert options

This is a configuration fragment, not a replacement for the node configuration. Keep the
network-specific settings in your existing file.

```json
{
  // <-- Rest of configuration -->
  // ...
  "insert_options": {
    "tx_cbor": "disable",
    "tx_out": {
      "value": "enable"
    },
    "ledger": "enable",
    "shelley": {
      "enable": true
    },
    "multi_asset": {
      "enable": true
    },
    "metadata": {
      "enable": true
    },
    "plutus": {
      "enable": true
    },
    "governance": "enable",
    "offchain_pool_data": "disable",
    "offchain_vote_data": "disable",
    "remove_jsonb_from_schema": "disable",
    "disable_epoch": false
  }
}
```

## Full preset equivalent

Explicit sibling options override a preset. This is an `insert_options` fragment:

```json
"tx_cbor": "disable",
"tx_out": {
  "value": "enable",
  "use_address_table": false
},
"ledger": "enable",
"shelley": {
  "enable": true
},
"multi_asset": {
  "enable": true
},
"metadata": {
  "enable": true
},
"plutus": {
  "enable": true
},
"governance": "enable",
"offchain_pool_data": "disable",
"offchain_vote_data": "disable",
"pool_stat": "enable",
"remove_jsonb_from_schema": "disable"
```

Stop db-sync and validate the complete edited configuration before restarting. Back up the
database and matching ledger state first. Test schema conversions on an isolated copy; a
conversion may be expensive and does not itself prove stored JSON payload fidelity.
