import {useEffect, useState} from 'react';
import committed from '@generated/chain-data/default/state.json';
import {ageCommittedState} from './data';
import type {NumbersState} from './types';

/** Hydrates the build state exactly, then ages it even if a failed cron never rebuilds the site. */
export default function useCommittedNumbersState(): NumbersState {
  const source = committed;
  const [state, setState] = useState(source);
  useEffect(() => {
    if (source.status === 'unavailable') return;
    const {snapshot} = source;
    const refresh = () => setState(ageCommittedState(source, new Date().toISOString()));
    refresh();
    const delay = Date.parse(snapshot.nextBoundary) - Date.now();
    const timer = delay > 0 ? window.setTimeout(refresh, delay) : undefined;
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [source]);
  return state;
}
