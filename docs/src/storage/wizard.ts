import {modelStorage, MODEL_LABEL} from './model';
import type {NumbersState, WizardConfiguration, WizardStorageState} from './types';

/** B33 consumes the validated build snapshot; no provider fetch or separate cost formula. */
export function wizardStorageState(
  state: NumbersState,
  configuration: WizardConfiguration,
): WizardStorageState {
  if (state.status === 'unavailable') return state;
  try {
    return {
      status: state.status,
      label: MODEL_LABEL,
      updatedAt: state.snapshot.updatedAt,
      storage: modelStorage(state.snapshot, configuration),
    };
  } catch {
    return {
      status: 'unavailable',
      reason: 'Modelled storage estimates unavailable for this configuration or chain sample.',
    };
  }
}
