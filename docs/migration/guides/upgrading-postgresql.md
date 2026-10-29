---
title: 'Upgrading PostgreSQL'
description: 'Migrated operational guidance from the project documentation.'
requires:
  tables: []
  columns: []
  config: []
---

> [!WARNING]
> This guide preserves legacy project documentation. Check commands, versions and destructive
> operations against your installed release, and verify backups before changing an existing deployment.

# Upgrading PostgreSQL

For major releases of PostgreSQL, the internal storage format is typically changed,
complicating upgrades.

## Requirements

- A verified backup of the database and matching ledger state, and a tested recovery plan.
- Enough free space for the chosen upgrade method, both clusters and backups; measure this for
  your deployment rather than assuming a fixed size.
- A prepared new cluster and version-specific PostgreSQL upgrade instructions.

This guide uses examples for Debian, but should apply to any Linux distribution.

## Install a New PostgreSQL Version

If you're using Debian (or Ubuntu), make sure you've enabled the [PostgreSQL APT
repository](https://wiki.postgresql.org/wiki/Apt), which will enable you to install
multiple versions.

Install a new PostgreSQL version alongside the existing:

```bash
sudo apt install postgresql-15
```

## Upgrade the Schemas

Stop the db-sync service using your deployment’s service name, prevent other database writers,
then stop the affected PostgreSQL cluster. The commands below assume a service named
`cardano-db-sync` and the default PostgreSQL service; confirm both names and the clusters they
control before running them.

```bash
sudo systemctl stop cardano-db-sync
sudo systemctl stop postgresql
```

This is a historical PostgreSQL 11-to-15 example, not a universal recipe. Confirm every binary,
data directory, configuration file, user and port for your actual clusters. Run `pg_upgrade
--check` with the same options first, consult the PostgreSQL documentation, and resolve any errors
before running the upgrade. Never run it against a live cluster.

Upgrade the existing schemas

```bash
cd /tmp
sudo -u postgres /usr/lib/postgresql/15/bin/pg_upgrade \
  --old-bindir=/usr/lib/postgresql/11/bin \
  --new-bindir=/usr/lib/postgresql/15/bin \
  --old-datadir=/var/lib/postgresql/11/main \
  --new-datadir=/var/lib/postgresql/15/main \
  --old-options="--config_file=/etc/postgresql/11/main/postgresql.conf" \
  --new-options="--config_file=/etc/postgresql/15/main/postgresql.conf"
```

Start PostgreSQL

```bash
sudo systemctl start postgresql
```

## Clean Up

Verify the new cluster, db-sync connectivity and application queries before considering removal of
the old cluster. Keep the old cluster and verified backups until the upgrade has been accepted and
your rollback period has expired. Follow the distribution and PostgreSQL documentation for removal;
do not blindly run a generated deletion script or remove a generic package that may be in use.
