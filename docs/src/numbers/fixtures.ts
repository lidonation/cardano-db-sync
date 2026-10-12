import React from 'react';

import NumbersPage from './NumbersPage';
import {numbersState} from './data';
import type {CardanoNetwork, NumbersSnapshot} from './types';

/** Development-only synthetic data. No values here describe a real database or wizard. */
export function syntheticNumbersSnapshot(network: CardanoNetwork = 'preview'): NumbersSnapshot {
  return {
    network,
    updatedAt: '2026-10-12T00:00:00.000Z',
    nextBoundary: '2026-10-13T00:00:00.000Z',
    source: 'Synthetic browser test fixture, not a provider measurement',
    blockHeight: 1000000,
    epoch: 100,
    transactions: 5678,
    blocksThisEpoch: 1234,
    recentEpochs: Array.from({length: 12}, (_, index) => ({
      epoch: 88 + index,
      blocks: 1234,
      transactions: 5678,
      boundary: new Date(Date.UTC(2026, 9, index + 1)).toISOString(),
    })),
    storage: {
      methodology: 'Synthetic estimates for browser test only. Not real wizard output.',
      configuration: 'full',
      databaseGB: 120,
      monthlyCostUSD: 12,
      tables: [
        {name: 'tx_out', gigabytes: 60},
        {name: 'tx', gigabytes: 30},
      ],
      growth: Array.from({length: 12}, (_, index) => ({epoch: 88 + index, gigabytes: 1 + index})),
    },
  };
}

export default function NumbersFixture(): React.ReactElement {
  const kind =
    typeof window === 'undefined'
      ? 'ready'
      : window.location.pathname.split('/').filter(Boolean).at(-1);
  const network: CardanoNetwork = kind === 'mainnet' ? 'mainnet' : 'preview';
  const snapshot = syntheticNumbersSnapshot(network);
  const raw =
    kind === 'missing'
      ? null
      : kind === 'invalid'
        ? {...snapshot, transactions: -1}
        : kind === 'network'
          ? {...snapshot, network: 'mainnet'}
          : kind === 'no-model'
            ? {...snapshot, storage: null}
            : snapshot;
  const asOf = kind === 'stale' ? '2026-10-13T00:00:00.000Z' : '2026-10-12T12:00:00.000Z';
  return React.createElement(NumbersPage, {state: numbersState(raw, network, asOf), network});
}
