---
title: 'Installing with Nix'
description: 'Migrated operational guidance from the project documentation.'
requires:
  tables: []
  columns: []
  config: []
---

> [!WARNING]
> This guide preserves legacy project documentation. Check commands, versions and destructive
> operations against your installed release, and verify backups before changing an existing deployment.

# Installing with Nix

[Nix](https://nixos.org/download.html) is a purely functional package manager that creates
reproducible, declarative and reliable systems. This is the only dependency required to
build Cardano DB Sync.

## Prerequisites

This guide assumes you have the following tools:

- [Nix](https://nixos.org/download.html)
- [Cardano Node](https://github.com/IntersectMBO/cardano-node/blob/master/doc/getting-started/building-the-node-using-nix.md)

Nix will handle all other dependencies.

Create a working directory for your builds:

```bash
mkdir -p ~/src
cd ~/src
```

## Configure Nix

Enable [Flakes](https://nixos.wiki/wiki/Flakes) and import-from-derivation support using the
Nix documentation for your installation. If modifying `/etc/nix/nix.conf`, back it up first and
merge the required settings with existing values rather than overwriting the file. Review binary
cache URLs and trusted keys with your administrator before adding them; do not replace an existing
substituter or trusted-key list without understanding the effect.

Check the [Nix flakes documentation](https://nixos.wiki/wiki/Flakes#Enable_flakes) for the
current instructions.

## Add the Binary Cache

Follow the project and Nix documentation to configure an approved binary cache. This is optional,
but can reduce build time. Keep existing trusted settings and verify any new cache key.

## Download the Source

Enter the working directory for your builds:

```bash
cd ~/src
```

Find the latest release here: https://github.com/IntersectMBO/cardano-db-sync/releases

Check out the latest release version:

```bash
git clone https://github.com/IntersectMBO/cardano-db-sync.git
cd cardano-db-sync
git fetch --all --tags
git checkout tags/<VERSION>
```

## Build and Install

Build Cardano DB Sync with `nix`:

```bash
nix build .
```

This will build the executable and link it in `./result`.

Install it in your nix proile:

```bash
nix profile install .
```

Check the version that has been installed:

```bash
cardano-db-sync --version
```
