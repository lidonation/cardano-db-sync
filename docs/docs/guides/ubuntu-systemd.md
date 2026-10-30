---
title: Ubuntu systemd service
description: Run db-sync under a dedicated Ubuntu systemd account.
requires:
  tables: []
  columns: []
  config: []
---

# Ubuntu systemd service

This guide runs an installed db-sync binary as a dedicated system account against Cardano
**preview**. A separately managed Cardano node, PostgreSQL and network configuration must already
be running. Use paths and versions appropriate for your installation; the examples are not a
substitute for a verified backup and upgrade plan.

## Prerequisites

1. Install a release-compatible `cardano-db-sync` binary at `/usr/local/bin/cardano-db-sync`, and
   install the matching release's `schema/` directory at `/opt/dbsync/schema`.
2. Configure a Cardano node on preview. Its socket is assumed to be
   `/run/cardano-node/node.socket`; arrange filesystem permissions so the db-sync service account
   can traverse the directory and connect. Use a dedicated shared group where appropriate. The
   socket itself must grant write access to that account or group; directory access alone is not
   enough. Ensure that access is restored after node restarts, without making the socket world-writable.
3. Place the matching preview db-sync configuration and all files it refers to under
   `/etc/cardano/preview/`. This example uses `/etc/cardano/preview/db-sync-config.json`.
4. Provision an empty PostgreSQL database and a dedicated database user with the permissions
   required by your deployment. Ensure PostgreSQL and the node use the intended network.

## Create the service account and protected credentials

```sh
sudo useradd --system --home-dir /var/lib/cardano-db-sync --shell /usr/sbin/nologin dbsync
sudo install -d -o dbsync -g dbsync -m 750 /var/lib/cardano-db-sync
sudo install -d -o root -g dbsync -m 750 /etc/dbsync
```

Create `/etc/dbsync/pgpass` securely using your secret-management process. For db-sync 13.7.2.1,
the first line must contain `hostname:port:database:username:password`, with no colons or backslashes
in any field. Unlike PostgreSQL's general password-file format, db-sync does not unescape escaped
characters. Use a high-entropy password from an alphabet that excludes those characters and confirm
these rules against the release you run. Avoid entering passwords in shell history or committing
this file.

Restrict access to logs, do not paste credentials into tickets, and rotate a credential if it has
been exposed. Make the file readable only by the service account:

```sh
sudo chown dbsync:dbsync /etc/dbsync/pgpass
sudo chmod 600 /etc/dbsync/pgpass
```

## Install the unit

Save the following as `/etc/systemd/system/cardano-db-sync.service`. Adjust the paths and add the
socket's group as `SupplementaryGroups` if required. `network-online.target` does not guarantee a
remote PostgreSQL server or the node is ready; inspect logs if startup retries occur.

```ini
[Unit]
Description=Cardano DB Sync
Wants=network-online.target
After=network-online.target

[Service]
Type=simple
User=dbsync
Group=dbsync
Environment=PGPASSFILE=/etc/dbsync/pgpass
ExecStart=/usr/local/bin/cardano-db-sync --config /etc/cardano/preview/db-sync-config.json --socket-path /run/cardano-node/node.socket --state-dir /var/lib/cardano-db-sync --schema-dir /opt/dbsync/schema
Restart=on-failure
RestartSec=10
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
```

Verify the unit, reload systemd and start it:

```sh
sudo systemd-analyze verify /etc/systemd/system/cardano-db-sync.service
sudo systemctl daemon-reload
sudo systemctl enable --now cardano-db-sync.service
sudo systemctl status cardano-db-sync.service
sudo journalctl -u cardano-db-sync.service -f
```

## Verification and recovery

A running service is not proof of a fully synced database. Inspect the journal and compare the
node and database chain tips with a trusted preview source. Verify that the configured database
is the intended one before allowing applications to use it.

If startup fails, inspect the journal, socket and directory permissions, PostgreSQL connection and
credentials, config file paths, and disk space. Do not paste credentials into logs or tickets.
Before an upgrade, stop the service and take verified, compatible PostgreSQL and ledger-state
backups. A binary rollback does not undo a schema migration: confirm compatibility or restore
matching backups before starting the previous version. Do not remove state or drop the database
as a first troubleshooting step.
