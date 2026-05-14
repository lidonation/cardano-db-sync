---
title: "Cardano DB Sync"
description: "A component that follows the Cardano chain and stores blocks and transactions in PostgreSQL."
order: 0
category: "Overview"
---

# Cardano DB Sync

Cardano DB Sync follows the Cardano blockchain and stores chain data in a PostgreSQL database, making it easy to query historical blocks, transactions, staking, and governance data.

## Architecture

The project has three main components:

- **`cardano-db`** — data types and PostgreSQL schema definitions
- **`cardano-db-tool`** — database management utilities (migrations, validation, rollbacks)
- **`cardano-db-sync`** — the main node that connects to a running `cardano-node` and syncs chain data to PostgreSQL

## System Requirements (mainnet)

| Resource | Minimum |
|----------|---------|
| RAM | 64 GB |
| CPU | 4+ cores |
| IOPS | 60k+ |
| Disk | 700+ GB SSD |

## Quick Start

Choose your installation path:

- **[Installing from Source](/installing)** — build from source on Linux
- **[Installing with Nix](/installing-with-nix)** — recommended for reproducible builds
- **[Docker](/docker)** — fastest way to get running locally

## Help Us Improve

If your team uses DB Sync, please take 3 minutes to fill out our [usage survey](/survey).
You can see aggregated, anonymised results on the [dashboard](/survey/results).
