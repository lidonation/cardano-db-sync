---
title: Diagnose off-chain pool metadata
description: Check pool and governance metadata fetching and hashes.
requires:
  tables: [pool_metadata_ref, off_chain_pool_data, off_chain_pool_fetch_error]
  columns: []
  config: [insert_options.offchain_pool_data, ipfs_gateway]
---

# Diagnose off-chain pool metadata

The metadata fetcher reads pool references from the database and stores successful fetches or
errors. This guide covers the operational checks; field-level reference belongs in the generated
schema and configuration reference.

## Prerequisites

Use a db-sync release built with the metadata tools and a database on the intended network. The
`insert_options.offchain_pool_data` setting controls pool fetching; check the effective setting
and the release's defaults before diagnosing missing data. Do not use an untrusted URL from a
privileged network without understanding your outbound network controls.

## Check one URL and hash

From a matching source checkout, replace the example arguments with the URL and hexadecimal hash
from the pool registration:

```sh
cabal run http-get-json-metadata -- https://example.org/pool.json EXPECTED_HASH
```

A successful network fetch reports `Success` and the JSON. A hash mismatch reports the computed
hash, but matching a hash does not establish that the content is trustworthy. The tool can also
inspect governance metadata: use `url drep URL HASH` for a network fetch or `drep FILE` to parse a
local file. Local-file output includes a validity line and a computed hash.

For an `ipfs://` anchor, the daemon uses its configured `ipfs_gateway`, but the debug tool does
not resolve IPFS itself. Convert the address to an approved HTTPS gateway URL before testing; a
rate-limited or unavailable gateway is not by itself evidence of invalid metadata.

## Check all stored pool references

This operation fetches many external URLs and may generate substantial traffic. Run it only with
permission, network limits and an appropriate maintenance window. Point `PGPASSFILE` at a protected
PostgreSQL password file for the intended database:

```sh
PGPASSFILE=/path/to/pgpass cabal run test-http-get-json-metadata
```

Review the summary by error category and the daemon logs. Check DNS, timeouts, content type, hash
mismatches and fetch retries before concluding data is absent. Do not publish credentials or
sensitive URLs in diagnostics. Retired pools are skipped by the bulk check.
