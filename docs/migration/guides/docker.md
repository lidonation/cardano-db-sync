---
title: 'Docker'
description: 'Migrated operational guidance from the project documentation.'
requires:
  tables: []
  columns: []
  config: []
---

> [!WARNING]
> This guide preserves legacy project documentation. Check commands, versions and destructive
> operations against your installed release, and verify backups before changing an existing deployment.

# Docker

## Quickstart

We provide an example
[docker-compose.yml](https://github.com/IntersectMBO/cardano-db-sync/blob/master/docker-compose.example.yml)
to quickly get set up with `cardano-db-sync`. Keep in mind that this is only a template,
and users are encouraged to tweak it to meet their needs.

It is not recommended to use this for a production set up, and should only be
used for local development.

Create a working directory:

```bash
mkdir ~/src
cd ~/src
```

Download the example Docker Compose file:

```bash
REPOSITORY=cardano-db-sync
curl -o docker-compose.yml \
  "https://raw.githubusercontent.com/IntersectMBO/${REPOSITORY}/master/docker-compose.example.yml"
```

The downloaded example publishes PostgreSQL on every interface with a public development
password. **Do not start it unchanged.** Require Docker Compose 2.24.4 or newer, then save this
as `docker-compose.local.yml` to replace, not append to, its published port list:

```yaml
services:
  postgres:
    ports: !override
      - '127.0.0.1:5432:5432'
```

Use a fresh local test environment and replace the example database credentials before use.
Start `cardano-node`, `postgresql`, and `cardano-db-sync` with both files:

```bash
docker compose -f docker-compose.yml -f docker-compose.local.yml up -d && \
  docker compose -f docker-compose.yml -f docker-compose.local.yml logs -f
```

The PostgreSQL database should now be exposed on localhost port `5432`

To connect to PostgreSQL database:

```bash
psql -h 127.0.0.1 -p 5432 -U postgres -d cexplorer
```

### Connecting to a Other Networks

Select the network **before the first start**. Never reuse a populated database or ledger/node
volumes from another network. For a fresh preprod environment, use `NETWORK` on every Compose
operation and keep the same override:

```bash
NETWORK=preprod docker compose -f docker-compose.yml -f docker-compose.local.yml up -d && \
  docker compose -f docker-compose.yml -f docker-compose.local.yml logs -f
```

## Running `cardano-db-sync`

The image tags below match the Compose example in this checkout. Verify them against your
chosen release and pin approved image digests before deployment. Node, db-sync, configuration
and snapshot must be compatible; never run an older binary against a newer database schema.
The names below assume the Compose project's default `cardano-db-sync` name.
Before running an alternative standalone db-sync, stop the Compose db-sync service to prevent
concurrent writers, while leaving PostgreSQL and the node running:

```bash
docker compose -f docker-compose.yml -f docker-compose.local.yml stop cardano-db-sync
```

Prepare `$PWD/pgpass` with approved credentials for host `postgres`, database and port, readable
only by the container's service account (mode 0600). Do not put a password into a shell command.
Each example joins the Compose database network and mounts that file read-only. Adjust the
project-prefixed volume/network names if you selected another Compose project name.

Start `cardano-db-sync`:

```bash
docker run \
  --network cardano-db-sync_postgres \
  --env PGPASSFILE=/run/secrets/pgpass \
  --volume "$PWD/pgpass:/run/secrets/pgpass:ro" \
  --env NETWORK=mainnet \
  --env POSTGRES_HOST=postgres \
  --env POSTGRES_PORT=5432 \
  --volume cardano-db-sync_db-sync-data:/var/lib/cexplorer \
  --volume cardano-db-sync_node-ipc:/node-ipc:ro \
  ghcr.io/intersectmbo/cardano-db-sync:13.7.2.1
```

### Environment Variables

#### `NETWORK`

Specifies a network to connect to. If specified, `cardano-db-sync` will provide the
configuration files. If not specified, will call the `cardano-db-sync` executable as the
entrypoint. Possible values are:

- mainnet
- preprod
- preview
- private
- sanchonet
- shelley_qa

#### `POSTGRES_HOST`

The PostgreSQL server host to connect to. This variable is ignored if `PGPASSFILE` is set.

#### `POSTGRES_PORT`

Specifies the PostgreSQL server port to connect to. This variable is ignored if `PGPASSFILE` is set.

#### `POSTGRES_DB`

The PostgreSQL database name to connect to. If left unset, the value is read from `/run/secrets/postgres_db`. Both the variable and the file are ignored if `PGPASSFILE` is set.

#### `POSTGRES_USER`

The PostgreSQL server user to connect as. If left unset, the value is read from `/run/secrets/postgres_user`. Both the variable and the file are ignored if `PGPASSFILE` is set.

#### `POSTGRES_PASSWORD`

Specifies the PostgreSQL server password to connect as. If left unset, the value is read from `/run/secrets/postgres_password`. Both the variable and the file are ignored if `PGPASSFILE` is set.

#### `PGPASSFILE`

Path to a file containing PostgreSQL connection information. Note that `PGPASSFILE` with Docker secrets is preferred when Docker secrets are available.

#### `RESTORE_SNAPSHOT` (optional)

Specifies a `cardano-db-sync` snapshot archive to download and restore from. If omitted,
it will sync from genesis. see [Restoring From Snapshots](#restoring-from-snapshots)

#### `DB_SYNC_CONFIG` (optional)

Overrides the `db-sync-config.json` provided by the network configuration. See [Overriding
Network Configuration](#overriding-network-configuration).

#### `EXTRA_DB_SYNC_ARGS` (optional)

Extra command line arguments to pass to `cardano-db-sync`. For example:

```bash
docker run \
  --network cardano-db-sync_postgres \
  --env PGPASSFILE=/run/secrets/pgpass \
  --volume "$PWD/pgpass:/run/secrets/pgpass:ro" \
  --env NETWORK=mainnet \
  --env POSTGRES_HOST=postgres \
  --env POSTGRES_PORT=5432 \
  --env EXTRA_DB_SYNC_ARGS="--disable-cache" \
  --volume cardano-db-sync_db-sync-data:/var/lib/cexplorer \
  --volume cardano-db-sync_node-ipc:/node-ipc:ro \
  ghcr.io/intersectmbo/cardano-db-sync:13.7.2.1
```

### Overriding Network Configuration

Overriding the configuration file can be done by passing the `DB_SYNC_CONFIG` environment
variable:

```bash
docker run \
  --network cardano-db-sync_postgres \
  --env PGPASSFILE=/run/secrets/pgpass \
  --volume "$PWD/pgpass:/run/secrets/pgpass:ro" \
  --env NETWORK=mainnet \
  --env POSTGRES_HOST=postgres \
  --env POSTGRES_PORT=5432 \
  --env DB_SYNC_CONFIG=/config/db-sync-config.json \
  --volume cardano-db-sync_db-sync-data:/var/lib/cexplorer \
  --volume cardano-db-sync_node-ipc:/node-ipc:ro \
  --volume $PWD/environments/mainnet:/config \
  ghcr.io/intersectmbo/cardano-db-sync:13.7.2.1
```

### Restoring From Snapshots

Snapshots are provided for mainnet to restore the PostgreSQL database. See the [latest
releases](https://github.com/IntersectMBO/cardano-db-sync/releases) for a recent snapshot
matched with the `cardano-db-sync` version.

Download the archive separately so retries do not repeatedly download it. Choose a trusted
snapshot URL for the same network and compatible db-sync/schema/platform release, then set
`SNAPSHOT_URL` in your shell. The command fails if it is unset:

```bash
: "${SNAPSHOT_URL:?Set SNAPSHOT_URL to the approved compatible snapshot URL}"
mkdir -p snapshots
curl --fail --location --output snapshots/db-sync-snapshot.tgz "$SNAPSHOT_URL"
```

Verify the archive against its trusted publisher's checksum or signature. Restore only into
an empty database and empty state volume, with all other writers stopped and a tested backup.
Create a separate protected `pgpass-restore` file targeting that empty database, and a new empty
Docker volume `db-sync-restore-data`. Do not reuse a populated Compose state volume.
Restore the snapshot with `RESTORE_SNAPSHOT`:

```bash
docker run \
  --network cardano-db-sync_postgres \
  --env PGPASSFILE=/run/secrets/pgpass \
  --volume "$PWD/pgpass-restore:/run/secrets/pgpass:ro" \
  --env NETWORK=mainnet \
  --env POSTGRES_HOST=postgres \
  --env POSTGRES_PORT=5432 \
  --env RESTORE_SNAPSHOT=/data/db-sync-snapshot.tgz \
  --volume db-sync-restore-data:/var/lib/cexplorer \
  --volume cardano-db-sync_node-ipc:/node-ipc:ro \
  --volume "$PWD/snapshots:/data:ro" \
  ghcr.io/intersectmbo/cardano-db-sync:13.7.2.1
```

### Advanced Usage

Excluding the `NETWORK` environment variable will simply call the `cardano-db-sync`
executable as the entrypoint, so you must pass command line arguments to projvide runtime
configuration. The `--schema-dir` argument is automatically set and is not required.

```bash
docker run \
  --network cardano-db-sync_postgres \
  --env PGPASSFILE=/run/secrets/pgpass \
  --volume "$PWD/pgpass:/run/secrets/pgpass:ro" \
  --volume cardano-db-sync_db-sync-data:/var/lib/cexplorer \
  --volume cardano-db-sync_node-ipc:/node-ipc:ro \
  --volume $PWD/environments/mainnet:/config \
  ghcr.io/intersectmbo/cardano-db-sync:13.7.2.1 \
  --config /config/db-sync-config.json --socket-path /node-ipc/node.socket
```

## Running `cardano-smash-server`

Start `cardano-smash-server` for local testing. Supply `SMASH_PASSWORD` from an approved secret
mechanism, not a literal in shell history. Environment variables are visible to container
administrators. The example binds the port to loopback; protect administrative access with TLS
and network controls before exposing it remotely. The entrypoint writes its administrator CSV
under `/configuration`, so prepare a private writable directory for it. Load and export
`SMASH_PASSWORD` through your approved secret mechanism before running either example:

```bash
: "${SMASH_PASSWORD:?Load an approved SMASH password before starting}"
export SMASH_PASSWORD
mkdir -p smash-config
chmod 700 smash-config
```

```bash
docker run \
  --network cardano-db-sync_postgres \
  --env PGPASSFILE=/run/secrets/pgpass \
  --volume "$PWD/pgpass:/run/secrets/pgpass:ro" \
  --volume "$PWD/smash-config:/configuration" \
  --env NETWORK=mainnet \
  --env POSTGRES_HOST=postgres \
  --env POSTGRES_PORT=5432 \
  --env SMASH_USER=smash-admin \
  --env SMASH_PASSWORD \
  --publish 127.0.0.1:3100:3100 \
  --volume cardano-db-sync_node-ipc:/node-ipc:ro \
  ghcr.io/intersectmbo/cardano-smash-server:13.7.2.1
```

### Environment Variables

#### `NETWORK` (optional)

Specifies a network to connect to. If specified, `cardano-db-sync` will provide the
configuration files. If not specified, will call the `cardano-db-sync` executable as the
entrypoint. Possible values are:

- mainnet
- preprod
- preview
- private
- sanchonet
- shelley_qa

#### `POSTGRES_HOST`

The PostgreSQL server host to connect to. This variable is ignored if `PGPASSFILE` is set.

#### `POSTGRES_PORT`

Specifies the PostgreSQL server port to connect to. This variable is ignored if `PGPASSFILE` is set.

#### `POSTGRES_DB`

The PostgreSQL database name to connect to. If left unset, the value is read from `/run/secrets/postgres_db`. Both the variable and the file are ignored if `PGPASSFILE` is set.

#### `POSTGRES_USER`

The PostgreSQL server user to connect as. If left unset, the value is read from `/run/secrets/postgres_user`. Both the variable and the file are ignored if `PGPASSFILE` is set.

#### `POSTGRES_PASSWORD`

Specifies the PostgreSQL server password to connect as. If left unset, the value is read from `/run/secrets/postgres_password`. Both the variable and the file are ignored if `PGPASSFILE` is set.

#### `PGPASSFILE`

Path to a file containing PostgreSQL connection information. Note that `PGPASSFILE` with Docker secrets is preferred when Docker secrets are available.

#### `SMASH_USER` (optional)

Sets the user for HTTP basic authentication

#### `SMASH_PASSWORD` (optional)

Sets the password for HTTP basic authentication

### Advanced Usage

Excluding the `NETWORK` environment variable will simply call the `cardano-smash-server`
executable as the entrypoint, so you must pass command line arguments to provide runtime
configuration.

```bash
docker run \
  --env SMASH_USER=smash-admin \
  --env SMASH_PASSWORD \
  --network cardano-db-sync_postgres \
  --env PGPASSFILE=/run/secrets/pgpass \
  --volume "$PWD/pgpass:/run/secrets/pgpass:ro" \
  --volume "$PWD/smash-config:/configuration" \
  --volume cardano-db-sync_node-ipc:/node-ipc:ro \
  --volume $PWD/environments/mainnet:/config \
  ghcr.io/intersectmbo/cardano-smash-server:13.7.2.1 \
  --config /config/db-sync-config.json --port 3100 --admins /configuration/admins.csv
```

## Building

Building Docker images is done with [Nix](https://nixos.org/) and requires Linux:

```bash
nix build .#cardano-db-sync-docker
```

This will generate a `tar.gz` file linked to `./result` that can be loaded into docker and
run as a normal image.

```bash
docker load < result
docker run cardano-db-sync
```

## Running Tests with Docker PostgreSQL

Use a disposable local test database, not a deployment database. Replace the public example
values in `config/secrets/postgres_*` through your approved secret-management process and
prepare `config/pgpass-test` securely with matching connection fields; never put a password in
a shell command. Protect that file, then export its path:

```bash
chmod 0600 config/pgpass-test
export PGPASSFILE=$PWD/config/pgpass-test
```

Start PostgreSQL via Docker Compose with the same loopback-only override defined above.
Stop any earlier test/Compose deployment holding port 5432; do not reuse its populated volumes
as a test target:

```bash
docker compose -f docker-test.yml -f docker-compose.local.yml up
```

Run the migrations:

```bash
cabal run cardano-db-tool -- run-migrations --mdir schema/ --ldir .
```

Run the tests:

```bash
cabal test cardano-db
```

When you've finished with testing, stop and remove the test containers:

```bash
docker compose -f docker-test.yml -f docker-compose.local.yml down
```
