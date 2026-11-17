import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type {LoadContext} from '@docusaurus/types';
import {afterEach, expect, it} from 'vitest';
import {readCommittedNumbers} from '../../plugins/chain-data';
const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, {recursive: true, force: true});
});
it('builds a named unavailable state with absent or malformed artifacts and no provider request', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'chain-plugin-'));
  dirs.push(root);
  const context = {siteDir: root} as LoadContext;
  expect(await readCommittedNumbers(context, 'preview', '2026-11-17T00:00:00.000Z')).toEqual({
    status: 'unavailable',
    reason: 'missing',
  });
  const {mkdir} = await import('node:fs/promises');
  await mkdir(path.join(root, 'generated'));
  await writeFile(path.join(root, 'generated/chain-preview.json'), '{bad');
  expect(await readCommittedNumbers(context, 'preview', '2026-11-17T00:00:00.000Z')).toEqual({
    status: 'unavailable',
    reason: 'invalid',
  });
  await writeFile(path.join(root, 'generated/chain-preview.json'), 'null\n');
  expect(await readCommittedNumbers(context, 'preview', '2026-11-17T00:00:00.000Z')).toEqual({
    status: 'unavailable',
    reason: 'missing',
  });
});

it('binds committed data to network/time and gives every locale one immutable build state', async () => {
  const {default: chainData} = await import('../../plugins/chain-data');
  const {vi} = await import('vitest');
  const {mkdir} = await import('node:fs/promises');
  const root = await mkdtemp(path.join(os.tmpdir(), 'chain-plugin-valid-'));
  dirs.push(root);
  await mkdir(path.join(root, 'generated'));
  const snapshot = {
    network: 'preview',
    updatedAt: '2026-11-17T00:05:00.000Z',
    nextBoundary: '2026-11-18T00:00:00.000Z',
    source: 'Synthetic plugin fixture',
    blockHeight: 1000,
    epoch: 1484,
    transactions: 10,
    blocksThisEpoch: 2,
    recentEpochs: [],
    storage: null,
  };
  const file = path.join(root, 'generated/chain-preview.json');
  await writeFile(file, JSON.stringify(snapshot));
  const context = {siteDir: root} as LoadContext;
  expect(await readCommittedNumbers(context, 'preview', snapshot.updatedAt)).toEqual({
    status: 'ready',
    snapshot,
  });
  expect(await readCommittedNumbers(context, 'preview', snapshot.nextBoundary)).toEqual({
    status: 'stale',
    snapshot,
  });
  expect(await readCommittedNumbers(context, 'preview', '2026-11-16T00:00:00.000Z')).toEqual({
    status: 'unavailable',
    reason: 'invalid',
  });
  await writeFile(path.join(root, 'generated/chain-mainnet.json'), JSON.stringify(snapshot));
  expect(await readCommittedNumbers(context, 'mainnet', snapshot.updatedAt)).toEqual({
    status: 'unavailable',
    reason: 'network',
  });
  vi.stubEnv('DOCS_PROFILE', 'dev');
  vi.useFakeTimers({toFake: ['Date']});
  vi.setSystemTime(new Date(snapshot.updatedAt));
  try {
    const states: string[] = [];
    for (const locale of ['en', 'ja']) {
      const plugin = chainData({...context, i18n: {currentLocale: locale}} as LoadContext);
      const args = {
        actions: {
          createData: async (_name: string, value: string) => {
            states.push(value);
            return 'virtual-state.json';
          },
        },
      } as Parameters<NonNullable<typeof plugin.contentLoaded>>[0];
      await plugin.contentLoaded!(args);
      await writeFile(file, 'not valid json');
    }
    expect(states.map((value) => JSON.parse(value))).toEqual([
      {status: 'ready', snapshot},
      {status: 'ready', snapshot},
    ]);
  } finally {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  }
});
