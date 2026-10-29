---
title: Restore from a snapshot
description: Restore a compatible database and ledger-state snapshot into a prepared target.
requires:
  tables: []
  columns: []
  config: []
---

# Restore from a snapshot

A db-sync snapshot pairs a PostgreSQL dump with ledger state. It can shorten an initial sync, but
only when its network, schema, db-sync release, node compatibility and architecture are suitable
for the target. The node tip should be ahead of the snapshot point.

> [!WARNING]
> Restore changes the target database and state directory. Use a fresh, empty database and a new
> empty ledger-state directory; verify the database named by `PGPASSFILE` before proceeding. Keep
> and test a backup of any existing deployment. Never restore an untrusted archive: the restore
> script extracts its contents and executes database statements.

## Prerequisites

- Stop db-sync and prevent another instance from writing the target database or state directory.
- Obtain a snapshot from a trusted source; verify its checksum or signature using the publisher's
  instructions. Check release notes for network, schema and platform compatibility.
- Install the matching release's `scripts/postgresql-setup.sh` and PostgreSQL tools. Provision an
  empty database and a dedicated service account; give its protected `PGPASSFILE` access to that
  database. Ensure enough disk space for the archive, extraction, database and ledger state.
- Prepare a new, empty directory writable by the db-sync user. Do not clear a live state directory
  as a shortcut.

## Restore

From the matching release checkout, substitute your approved paths:

```sh
PGPASSFILE=/path/to/pgpass scripts/postgresql-setup.sh \
  --restore-snapshot /path/to/trusted-snapshot.tgz /path/to/empty-state-directory
```

If restoration fails, do not start db-sync against a partially restored target. Inspect the error,
then prepare a clean target according to your database recovery procedures before retrying. Do not
assume that retrying over a partial restore is safe.

## Verify and resume

Inspect restore output, confirm the expected database and ledger-state files exist, then start
one db-sync instance with the matching network configuration and state directory. Inspect logs and
compare the node and database tips with a trusted source for the same network. A successful restore
or running process does not mean synchronization is complete. Keep your previous verified backup
until the restored instance and its dependent applications have been checked.
