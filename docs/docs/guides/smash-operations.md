---
title: Operate SMASH
description: Build and run the stake pool metadata aggregation server safely.
requires:
  tables: []
  columns: []
  config: [insert_options.offchain_pool_data]
---

# Operate SMASH

SMASH serves pool metadata from a db-sync database. db-sync must be running or have populated the
database; results from an instance that has not caught up can be stale. Enable off-chain pool
metadata in the db-sync configuration when it is required, and confirm the release-specific
settings before starting.

## Prerequisites

Install PostgreSQL client libraries, a compatible db-sync, and a matching Cardano node and SMASH
release. Provide a protected `PGPASSFILE` for the same database used by db-sync. Restrict database
access and plan how to expose the HTTP service securely.

## Build and start

From a checkout of the matching release:

```sh
cabal build cardano-smash-server
```

Prepare an administrator file with the format documented by the release, owned and readable only
by the service account. Replace the paths and port below with your own configuration:

```sh
PGPASSFILE=/path/to/pgpass cabal run cardano-smash-server -- \
  --config /path/to/db-sync-config.json \
  --port 3100 \
  --admins /path/to/admins.txt
```

Do not store credentials in source control, command-line arguments or shell history. Administrative
endpoints use basic authentication: protect them with a trusted TLS-terminating proxy and network
access controls. Plain HTTP on an untrusted network exposes credentials.

## Verify and troubleshoot

Review server and db-sync logs for database connection and metadata-fetch failures. From an
appropriately authorized client, request a known pool metadata record using the API path
`/api/v1/metadata/POOL_ID/POOL_META_HASH`, replacing the placeholders. Compare its hash with the
on-chain registration and check the db-sync chain tip. A successful HTTP response does not prove
the database is fully synced.

For administrative delisting, enlistment and ticker management, use the release's API reference
and an approved credential-handling method. Limit administrator access, audit changes, and do not
paste secrets into tickets. If data is missing, check the db-sync metadata configuration, fetch
errors and the node's synchronization before changing database state.
