import {numbersState} from './snapshot.mjs';
import type {CardanoNetwork, NumbersState} from './types';
export {numbersState};

/**
 * Ages the validated build state in the browser. A client clock behind the build host must not
 * turn good build data into `invalid`; it can only move the snapshot forward to `stale`.
 */
export function ageCommittedState(state: NumbersState, now: string): NumbersState {
  if (state.status === 'unavailable') return state;
  const {snapshot} = state;
  return numbersState(
    snapshot,
    snapshot.network,
    now > snapshot.updatedAt ? now : snapshot.updatedAt,
  );
}

/** Stable across build hosts, browser locales and hydration. UI strings use page translations. */
export const formatNumber = (value: number): string =>
  new Intl.NumberFormat(
    'en-US',
    value > 0 && value < 0.005
      ? {notation: 'scientific', maximumSignificantDigits: 3}
      : {maximumFractionDigits: 2},
  ).format(value);
export const formatUtc = (value: string): string =>
  `${value.slice(0, 10)} ${value.slice(11, 16)} UTC`;

/** The component's injected state is also network-bound, not only the production adapter. */
export function numbersForNetwork(state: NumbersState, network: CardanoNetwork): NumbersState {
  return state.status !== 'unavailable' && state.snapshot.network !== network
    ? {status: 'unavailable', reason: 'network'}
    : state;
}
