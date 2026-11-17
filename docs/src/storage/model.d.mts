import type {NumbersSnapshot} from '../numbers/types';
import type {ChainFacts, StorageEstimate, WizardConfiguration} from './types';
export const MODEL_LABEL: 'MODELLED ESTIMATES';
export const FULL_CONFIGURATION: {readonly insert_options: {readonly preset: 'full'}};
export function modelStorage(
  facts: ChainFacts,
  configuration?: WizardConfiguration,
): StorageEstimate;

export function storageModelMatches(snapshot: NumbersSnapshot): boolean;
