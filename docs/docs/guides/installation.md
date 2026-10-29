---
title: Install cardano-db-sync
description: Choose a container, Nix or source build and verify the installation.
requires:
  tables: []
  columns: []
  config: []
---

# Install cardano-db-sync

Choose one installation method for a release compatible with your Cardano node. The commands
below obtain or build db-sync; they do not start a node or create a database.

## Prerequisites

You need a compatible running Cardano node, a PostgreSQL database, network configuration and enough
storage for chain data. The Docker method needs Docker; the Nix method needs Nix with flakes
enabled; the Cabal method needs the GHC, Cabal and native libraries listed in the upstream
[source installation instructions](https://github.com/IntersectMBO/cardano-db-sync/blob/master/doc/installing.md).
For the source methods, first clone the repository and check out a verified release tag:

```sh
git clone https://github.com/IntersectMBO/cardano-db-sync.git
cd cardano-db-sync
git fetch --tags
# Replace VERSION with a release tag chosen from the project's releases.
git checkout "tags/VERSION"
```

> [!NOTE]
> The container example uses the tag from the repository's Compose example. Confirm release
> compatibility and pin a verified digest before using it in your own environment.

## Choose an installation method

Run **one** of the following from the repository directory. On GitHub, the alternatives appear
as consecutive labelled code blocks; on the documentation site they appear as tabs.

```sh tab="Docker"
docker pull ghcr.io/intersectmbo/cardano-db-sync:13.7.2.1
```

```sh tab="nix"
nix build .
```

```sh tab="cabal"
cabal build cardano-db-sync
```

Nix places its result under `./result`; Cabal can locate its executable with
`cabal list-bin cardano-db-sync`. The image is intended to run with the node socket, db-sync
state and PostgreSQL configuration supplied by the operator. The repository's
[Compose example](https://github.com/IntersectMBO/cardano-db-sync/blob/master/docker-compose.example.yml)
is for local development, not production.

## Verify

Check the built binary with `./result/bin/cardano-db-sync --version` for Nix, or run the path
returned by `cabal list-bin cardano-db-sync` with `--version`. For a container image, verify the
pulled tag and digest with `docker image inspect` and follow the image's documented entrypoint.
Installation alone is not a sync check: once started, compare the node and database chain tips
with a trusted source for the same network.

## Troubleshooting

Check release compatibility, prerequisite versions, disk space and network access first. For Nix,
confirm flakes are enabled; for Cabal, verify the required native libraries and `pkg-config`
paths. For Docker, check image-pull permissions. Never delete a database or ledger state merely
to fix an installation failure; make verified backups before changing an existing deployment.
