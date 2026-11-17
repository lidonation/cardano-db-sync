import {readFile} from 'node:fs/promises';
import path from 'node:path';
import type {LoadContext, Plugin} from '@docusaurus/types';
import {resolveProfile} from '../../config/profiles';
import {numbersState} from '../../src/numbers/data';
import type {CardanoNetwork, NumbersState} from '../../src/numbers/types';

/** Reads committed public data only. Missing/broken data cannot make a no-key build fail. */
export async function readCommittedNumbers(
  context: Pick<LoadContext, 'siteDir'>,
  network: CardanoNetwork,
  asOf: string,
): Promise<NumbersState> {
  try {
    const raw: unknown = JSON.parse(
      await readFile(path.join(context.siteDir, `generated/chain-${network}.json`), 'utf8'),
    );
    return numbersState(raw, network, asOf);
  } catch (error) {
    return {
      status: 'unavailable',
      reason: (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'missing' : 'invalid',
    };
  }
}

// One immutable build-time state across every locale and SSR/hydration. No browser clock here.
const states = new Map<string, Promise<NumbersState>>();
export default function chainData(context: LoadContext): Plugin {
  const {network} = resolveProfile();
  return {
    name: 'chain-data',
    async contentLoaded({actions: {createData}}) {
      const key = `${context.siteDir}\0${network}`;
      let state = states.get(key);
      if (!state) {
        state = readCommittedNumbers(context, network, new Date().toISOString());
        states.set(key, state);
      }
      await createData('state.json', JSON.stringify(await state));
    },
  };
}
