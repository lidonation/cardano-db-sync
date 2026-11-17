import type {NumbersSnapshot, NumbersState} from '../numbers/types';

/** Provider facts only. The storage model never treats chain volume as a DB measurement. */
export type ChainFacts = Omit<NumbersSnapshot, 'storage'>;
export type StorageEstimate = NonNullable<NumbersSnapshot['storage']>;

/** A validated B10 config fragment, not a second set of wizard-specific option names. */
export type WizardConfiguration = Readonly<Record<string, unknown>>;

/** B33's result-panel contract; carries provenance and honesty copy with the values. */
export type WizardStorageState =
  | {readonly status: 'unavailable'; readonly reason: string}
  | {
      readonly status: 'ready' | 'stale';
      readonly label: 'MODELLED ESTIMATES';
      readonly updatedAt: string;
      readonly storage: StorageEstimate;
    };

export type {NumbersState};
