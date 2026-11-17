import type {CardanoNetwork, NumbersSnapshot} from '../src/numbers/types';
export function epochBoundary(network: CardanoNetwork, epoch: number): string;
export function refreshNetwork(
  input: {network: CardanoNetwork; key: string; existing: unknown; now?: string},
  http?: typeof fetch,
): Promise<
  | {status: 'updated'; snapshot: NumbersSnapshot}
  | {status: 'unchanged' | 'unconfigured'; snapshot: unknown}
>;
export function main(
  directory?: string,
  env?: NodeJS.ProcessEnv,
  http?: typeof fetch,
  now?: string,
  out?: Pick<Console, 'log' | 'error'>,
): Promise<number>;
