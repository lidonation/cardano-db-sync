import {SAMPLE_QUERIES} from './sample-queries';

/** Mainnet examples, run from the repository root after configuring pgpass and installing the binary. */
export const QUICKSTART_COMMANDS = {
  restore:
    'PGPASSFILE=config/pgpass-mainnet scripts/postgresql-setup.sh --restore-snapshot path/to/snapshot.tgz ledger-state/mainnet',
  run: 'PGPASSFILE=config/pgpass-mainnet cardano-db-sync --config config/mainnet-config.yaml --socket-path path/to/node.socket --state-dir ledger-state/mainnet --schema-dir schema/',
  // PGPASSFILE supplies passwords only. libpq also needs the connection fields db-sync reads.
  query: `export PGPASSFILE=config/pgpass-mainnet
export PGHOST="$(cut -d: -f1 "$PGPASSFILE")"
export PGPORT="$(cut -d: -f2 "$PGPASSFILE")"
export PGDATABASE="$(cut -d: -f3 "$PGPASSFILE")"
PGUSER="$(cut -d: -f4 "$PGPASSFILE")"
if [ "$PGUSER" = "*" ]; then PGUSER="$(id -un)"; fi
export PGUSER
psql -c '${SAMPLE_QUERIES.syncCheck}'`,
} as const;
