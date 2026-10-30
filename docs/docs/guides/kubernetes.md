---
title: Running on Kubernetes
description: Run one db-sync instance against Cardano preview using persistent storage.
requires:
  tables: []
  columns: []
  config: []
---

# Running on Kubernetes

This example runs a Cardano node and db-sync in one pod against **preview**, with a separately
managed PostgreSQL database. The containers share the node socket; node and db-sync state use
persistent volumes. It is a starting point for an operator, not a production-ready chart.

## Prerequisites

- A Kubernetes cluster, `kubectl`, and a namespace selected in your current context.
- A PostgreSQL service reachable from that namespace, with an empty database and a dedicated
  db-sync user. Back it up independently of the volumes below. Confirm that connection settings,
  TLS and network policy meet your environment's requirements.
- Two provisioned PersistentVolumeClaims named `node-db` and `db-sync-data`. Size them for the
  chain, database and expected growth; their storage must be writable by the container images.
- A Secret named `dbsync-postgres` with keys `host`, `port`, `database`, `user`, and `password`.
  Create it using your normal secret-management process; do not commit its values to Git. Limit
  Secret access with Kubernetes RBAC and encryption at rest. The container receives these values
  as environment variables; restrict who can inspect pods and their processes. In the 13.7.2.1 image,
  use no colons or backslashes in any of these values and no line breaks within a value: the image
  writes them to a colon-separated password file without escaping. Choose a high-entropy password from an alphabet that excludes
  those characters and verify the requirements of the image version you deploy.
- Sufficient disk, memory and time for initial sync. Verify the image tags and their compatibility
  with your chosen node and db-sync release before deployment.

## Deploy

Save the following as `dbsync.yaml`. The tags match the repository's example Compose file; pin
verified image digests under your own supply-chain policy. Both containers use `preview` and the
same socket volume. `Recreate` and one replica prevent two instances from writing the same state
during a rollout. Do not scale this deployment above one replica against the same database. This
is not distributed fencing: production deployments also need storage and database protections
against an old instance continuing to write after a node or network failure.

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: cardano-dbsync
spec:
  replicas: 1
  strategy:
    type: Recreate
  selector:
    matchLabels:
      app: cardano-dbsync
  template:
    metadata:
      labels:
        app: cardano-dbsync
    spec:
      containers:
        - name: cardano-node
          image: ghcr.io/intersectmbo/cardano-node:11.0.1
          env:
            - name: NETWORK
              value: preview
          volumeMounts:
            - name: node-db
              mountPath: /data/db
            - name: node-ipc
              mountPath: /ipc
        - name: cardano-db-sync
          image: ghcr.io/intersectmbo/cardano-db-sync:13.7.2.1
          env:
            - name: NETWORK
              value: preview
            - name: POSTGRES_HOST
              valueFrom:
                secretKeyRef:
                  name: dbsync-postgres
                  key: host
            - name: POSTGRES_PORT
              valueFrom:
                secretKeyRef:
                  name: dbsync-postgres
                  key: port
            - name: POSTGRES_DB
              valueFrom:
                secretKeyRef:
                  name: dbsync-postgres
                  key: database
            - name: POSTGRES_USER
              valueFrom:
                secretKeyRef:
                  name: dbsync-postgres
                  key: user
            - name: POSTGRES_PASSWORD
              valueFrom:
                secretKeyRef:
                  name: dbsync-postgres
                  key: password
          volumeMounts:
            - name: db-sync-data
              mountPath: /var/lib/cexplorer
            - name: node-ipc
              mountPath: /node-ipc
      volumes:
        - name: node-db
          persistentVolumeClaim:
            claimName: node-db
        - name: db-sync-data
          persistentVolumeClaim:
            claimName: db-sync-data
        - name: node-ipc
          emptyDir: {}
```

Review the manifest and namespace, then apply it:

```sh
kubectl apply -f dbsync.yaml
kubectl rollout status deployment/cardano-dbsync
kubectl logs deployment/cardano-dbsync -c cardano-node --tail=100
kubectl logs deployment/cardano-dbsync -c cardano-db-sync --tail=100
```

The containers start independently; db-sync may retry or restart until the node socket and
PostgreSQL are available. A successful rollout only means Kubernetes started the containers; it
**does not** mean the node or database has caught up. Inspect logs and compare the node and database
chain tips with a trusted preview source before directing applications to the database.

## Troubleshooting and recovery

- Check `kubectl describe pod` for scheduling, image pull, volume and Secret errors. Inspect each
  container's logs separately. Check that both containers use the same network and socket volume.
- Check PostgreSQL connectivity, credentials, database permissions, TLS configuration and network
  policies without printing credentials. An unbound PVC or full disk requires operator action.
- Before changing images, take and verify compatible PostgreSQL and ledger-state backups. For an
  application rollout rollback, use `kubectl rollout undo deployment/cardano-dbsync` only after
  confirming that the previous release can use the current database schema. Kubernetes rollback
  does not reverse database migrations or restore volumes. Restore matching backups if needed;
  never delete persistent claims as a troubleshooting shortcut.
