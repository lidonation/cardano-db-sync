---
title: Monitoring and rollback recovery
description: Check the database tip and plan a controlled rollback.
requires:
  tables: [block]
  columns: [block.block_no, block.epoch_no, block.id, block.slot_no, block.time]
  config: []
---

# Monitoring and rollback recovery

A lagging database can be caused by node synchronization, network connectivity, storage,
PostgreSQL or db-sync itself. Diagnose before rolling back: a rollback deletes data and is not a
routine response to ordinary synchronization lag.

## Monitor the database tip

Connect with a read-only PostgreSQL account to the intended database, then run:

```sql
SELECT slot_no, block_no, epoch_no, time
FROM block
ORDER BY id DESC
LIMIT 1;
```

Compare the result and node tip with a trusted source for the **same network**, allowing for normal
lag. Inspect node and db-sync logs, database connectivity, free disk space and service restarts. An
empty result may indicate an empty or incorrectly selected database. Schema settings and sync
progress affect what other queries return.

## Plan a rollback

> [!WARNING]
> A manual rollback deletes blocks and related data. Stop db-sync, prevent concurrent writers, and
> make verified, compatible PostgreSQL and ledger-state backups before proceeding. Confirm the
> network, target database, release and rollback point with the operator responsible for the data.

Choose a slot based on the incident and the release's documented behavior. Review the detailed
[manual rollback guide](https://github.com/IntersectMBO/cardano-db-sync/blob/master/doc/manual-rollbacks.md) and test on an isolated copy first. With the matching
release's tool and a protected password file, the standalone form is:

```sh
PGPASSFILE=/path/to/pgpass cardano-db-tool rollback --slot SLOT_NUMBER
```

Replace `SLOT_NUMBER` with the reviewed integer; do not copy a mainnet example into another
network. After the tool completes, inspect its output and the database tip. Restart db-sync using
its normal service procedure, follow the logs, and verify that synchronization resumes. Keep the
backup until validation is complete. If the operation fails, stop and investigate rather than
manually deleting rows or repeatedly retrying against a partially changed database.
