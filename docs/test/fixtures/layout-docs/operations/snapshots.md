# Snapshots

DB Sync follows the chain from the node it is attached to and writes every block, transaction and ledger event into PostgreSQL. A first sync from genesis takes days rather than hours, so plan the hardware before you start, keep the database on fast local storage, and give PostgreSQL enough shared buffers that the hot indexes stay in memory while the insert rate is at its highest.
