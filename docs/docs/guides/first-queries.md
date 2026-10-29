---
title: Your first SQL queries
description: Use read-only queries to inspect the db-sync chain tip.
requires:
  tables: [block]
  columns: [block.block_no, block.epoch_no, block.id, block.slot_no, block.time]
  config: []
---

# Your first SQL queries

Use a read-only PostgreSQL account on the intended db-sync database. Ask your operator for the
connection details and use a protected password file or another approved authentication method;
do not paste passwords into shell history. For example, with connection information configured
in `PGPASSFILE`:

```sh
PGPASSFILE=/path/to/pgpass psql -d DATABASE_NAME
```

Replace `DATABASE_NAME` with the database you were given. Check the network before interpreting
results. A database that is still synchronizing is not a complete representation of the chain.

## Inspect the most recent stored block

```sql
SELECT slot_no, block_no, epoch_no, time
FROM block
ORDER BY id DESC
LIMIT 1;
```

The result is the latest stored row, not proof that db-sync has reached the network tip. Compare
it with the node and a trusted source on the same network.

## Inspect recent blocks

```sql
SELECT block_no, slot_no, time
FROM block
WHERE block_no IS NOT NULL
ORDER BY block_no DESC
LIMIT 10;
```

Rows and fields depend on the configured schema and synchronization state. For more examples and
historical output, see [Interesting SQL queries](https://github.com/IntersectMBO/cardano-db-sync/blob/master/doc/interesting-queries.md); check each query against
your release and retention settings before using it in an application.
