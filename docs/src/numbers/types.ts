import type {CardanoNetwork} from '../../config/profiles';

/** The committed B23 snapshot boundary. Provider facts and model outputs stay separate. */
export interface NumbersSnapshot {
  readonly network: CardanoNetwork;
  readonly updatedAt: string;
  readonly nextBoundary: string;
  readonly source: string;
  readonly blockHeight: number;
  readonly epoch: number;
  readonly transactions: number;
  readonly blocksThisEpoch: number;
  readonly recentEpochs: readonly {
    readonly epoch: number;
    readonly blocks: number;
    readonly transactions: number;
    readonly boundary: string;
  }[];
  readonly storage: {
    readonly methodology: string;
    readonly configuration: string;
    readonly databaseGB: number;
    readonly monthlyCostUSD: number;
    readonly tables: readonly {readonly name: string; readonly gigabytes: number}[];
    readonly growth: readonly {readonly epoch: number; readonly gigabytes: number}[];
  } | null;
}

export type NumbersState =
  | {readonly status: 'unavailable'; readonly reason: 'missing' | 'invalid' | 'network'}
  | {readonly status: 'ready' | 'stale'; readonly snapshot: NumbersSnapshot};

export type {CardanoNetwork};
