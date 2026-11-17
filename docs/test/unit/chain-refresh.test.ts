import {runAsScript} from './run-as-script';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {epochBoundary, refreshNetwork, main} from '../../scripts/chain-refresh.mjs';
import {numbersState} from '../../src/numbers/data';
import {wizardStorageState} from '../../src/storage/wizard';

const now = '2026-11-17T00:05:00.000Z';
const epoch = 1484;
const start = Date.parse('2026-11-17T00:00:00.000Z') / 1000;
function provider(change?: (route: string, value: unknown) => unknown) {
  const calls: string[] = [];
  const http = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const route = new URL(String(url)).pathname.replace('/api/v0', '');
    calls.push(route);
    expect(init?.headers).toEqual({project_id: 'test-project'});
    expect(init?.redirect).toBe('error');
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    const value =
      route === '/blocks/latest'
        ? {height: 1_000_000, epoch, time: start + 120}
        : route.endsWith('/previous')
          ? Array.from({length: 12}, (_, n) => ({
              epoch: epoch - n - 1,
              block_count: 1000,
              tx_count: 20_000,
            }))
          : {epoch, block_count: 10, tx_count: 100};
    return new Response(JSON.stringify(change ? change(route, value) : value));
  }) as unknown as typeof fetch;
  return {http, calls};
}
const input = {network: 'preview' as const, key: 'test-project', existing: null, now};
const temporary: string[] = [];
afterEach(async () => {
  for (const dir of temporary.splice(0)) await rm(dir, {recursive: true, force: true});
});
describe('chain refresh (NUM-3/NUM-4/NUM-5)', () => {
  it('writes validated model output from three bounded calls, pinning the tip epoch', async () => {
    const {http, calls} = provider();
    const result = await refreshNetwork(input, http);
    expect(calls).toEqual(['/blocks/latest', `/epochs/${epoch}`, `/epochs/${epoch}/previous`]);
    expect(result.status).toBe('updated');
    expect(numbersState(result.snapshot, 'preview', now).status).toBe('ready');
    expect(result.snapshot).toMatchObject({
      transactions: 100,
      epoch,
      nextBoundary: '2026-11-18T00:00:00.000Z',
    });
    if (result.status !== 'updated') throw new Error('snapshot missing');
    const wizard = wizardStorageState(numbersState(result.snapshot, 'preview', now), {
      insert_options: {preset: 'full'},
    });
    expect(wizard).toMatchObject({label: 'MODELLED ESTIMATES', storage: result.snapshot.storage});
    expect(await refreshNetwork(input, provider().http)).toEqual(result);
    expect(result.snapshot.recentEpochs[0].epoch).toBe(epoch - 12);
  });
  it('generates mainnet data with five-day boundaries using the same model', async () => {
    const mainEpoch = Math.floor(
      (Date.parse(now) - Date.parse(epochBoundary('mainnet', 0))) / 432_000_000,
    );
    const convert = (value: unknown): unknown =>
      Array.isArray(value)
        ? value.map(convert)
        : {
            ...(value as object),
            ...('epoch' in (value as object)
              ? {epoch: (value as {epoch: number}).epoch - epoch + mainEpoch}
              : {}),
          };
    const result = await refreshNetwork(
      {...input, network: 'mainnet'},
      provider((_route, value) => convert(value)).http,
    );
    expect(result.status).toBe('updated');
    if (result.status !== 'updated') throw new Error('not updated');
    expect(numbersState(result.snapshot, 'mainnet', now).status).toBe('ready');
    expect(result.snapshot.nextBoundary).toBe(epochBoundary('mainnet', mainEpoch + 1));
    expect(numbersState(result.snapshot, 'preview', now)).toEqual({
      status: 'unavailable',
      reason: 'network',
    });
  });
  it('timestamps acquisition after responses, not before a newly minted block', async () => {
    vi.useFakeTimers({toFake: ['Date']});
    vi.setSystemTime(new Date(now));
    try {
      const http = provider((route, value) => {
        vi.setSystemTime(new Date(Date.parse(now) + 2000));
        return route === '/blocks/latest'
          ? {...(value as object), time: Date.parse(now) / 1000 + 1}
          : value;
      }).http;
      const result = await refreshNetwork({...input, now: undefined}, http);
      expect(result.status).toBe('updated');
      if (result.status === 'updated')
        expect(result.snapshot.updatedAt).toBe('2026-11-17T00:05:02.000Z');
    } finally {
      vi.useRealTimers();
    }
  });
  it('refreshes a current-epoch snapshot when its saved model basis has changed', async () => {
    const result = await refreshNetwork(input, provider().http);
    if (result.status !== 'updated' || !result.snapshot.storage) throw new Error('Fixture missing');
    const existing = {
      ...result.snapshot,
      storage: {...result.snapshot.storage, methodology: 'Older model basis'},
    };
    const {http} = provider();
    expect((await refreshNetwork({...input, existing}, http)).status).toBe('updated');
    expect(http).toHaveBeenCalledTimes(3);
  });
  it('makes no requests without a key or before the next epoch; retains old provenance', async () => {
    const {http} = provider();
    expect((await refreshNetwork({...input, key: ''}, http)).status).toBe('unconfigured');
    expect(http).not.toHaveBeenCalled();
    const ready = (await refreshNetwork(input, http)).snapshot;
    const before = vi.fn() as unknown as typeof fetch;
    expect(await refreshNetwork({...input, existing: ready}, before)).toEqual({
      status: 'unchanged',
      snapshot: ready,
    });
    expect(
      await refreshNetwork(
        {...input, key: '', existing: ready, now: '2026-11-18T00:01:00.000Z'},
        before,
      ),
    ).toEqual({status: 'unconfigured', snapshot: ready});
    expect(before).not.toHaveBeenCalled();
  });
  it('derives exact network epoch boundaries from genesis, not hardcoded page copy', () => {
    expect(epochBoundary('preview', 1485)).toBe('2026-11-18T00:00:00.000Z');
    const p = Date.parse(epochBoundary('preview', 1)) - Date.parse(epochBoundary('preview', 0));
    const m = Date.parse(epochBoundary('mainnet', 1)) - Date.parse(epochBoundary('mainnet', 0));
    expect(p).toBe(86_400_000);
    expect(m).toBe(432_000_000);
  });
  it.each([
    (_route: string, _value: unknown) => ({}),
    (route: string, value: unknown) =>
      route === '/blocks/latest' ? {...(value as object), time: start - 1} : value,
    (route: string, value: unknown) =>
      route === `/epochs/${epoch}` ? {...(value as object), epoch: epoch + 1} : value,
    (route: string, value: unknown) => (route.endsWith('/previous') ? [] : value),
    (route: string, value: unknown) =>
      route.endsWith('/previous')
        ? Array(12).fill({epoch: epoch - 1, block_count: 1, tx_count: 2})
        : value,
    (route: string, value: unknown) =>
      route.endsWith('/previous') ? [{epoch: -1, block_count: -1, tx_count: 0}] : value,
  ])(
    'rejects malformed, stale-provider and incomplete data without publishing it %#',
    async (change) => {
      await expect(refreshNetwork(input, provider(change).http)).rejects.toThrow();
    },
  );
  it('rejects oversized payloads and preserves a named no-model state for empty epochs', async () => {
    const large = (async () => new Response(' '.repeat(1_000_001))) as typeof fetch;
    await expect(refreshNetwork(input, large)).rejects.toThrow(/provider request failed/i);
    const result = await refreshNetwork(
      input,
      provider((route, value) =>
        route.endsWith('/previous')
          ? (value as Record<string, unknown>[]).map((row) => ({
              ...row,
              block_count: 0,
              tx_count: 0,
            }))
          : value,
      ).http,
    );
    expect(result.status).toBe('updated');
    if (result.status !== 'updated') throw new Error('Expected no-model snapshot');
    expect(result.snapshot.storage).toBeNull();
    const noCalls = vi.fn() as unknown as typeof fetch;
    expect((await refreshNetwork({...input, existing: result.snapshot}, noCalls)).status).toBe(
      'unchanged',
    );
    expect(noCalls).not.toHaveBeenCalled();
  });
  it('sanitizes provider and transport failures without echoing secrets or bodies', async () => {
    for (const http of [
      async () => new Response('test-project', {status: 403}),
      async () => {
        throw new Error('test-project');
      },
    ]) {
      await expect(refreshNetwork(input, http as typeof fetch)).rejects.toThrow(
        /provider request failed/i,
      );
      try {
        await refreshNetwork(input, http as typeof fetch);
      } catch (error) {
        expect(String(error)).not.toContain('test-project');
      }
    }
  });
  it('runs the file-writing entrypoint, byte-identically, and preserves snapshots on failure', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'chain-refresh-test-'));
    temporary.push(dir);
    const env = {BLOCKFROST_PREVIEW_PROJECT_ID: 'test-project'};
    const out = {log: vi.fn(), error: vi.fn()};
    expect(await main(dir, {}, provider().http, now, out)).toBe(0);
    expect(await main(dir, env, provider().http, now, out)).toBe(0);
    const file = path.join(dir, 'chain-preview.json');
    const bytes = await readFile(file, 'utf8');
    await writeFile(file, 'null\n');
    expect(await main(dir, env, provider().http, now, out)).toBe(0);
    expect(await readFile(file, 'utf8')).toBe(bytes);
    expect(
      await main(
        dir,
        env,
        (async () => new Response('', {status: 429})) as typeof fetch,
        '2026-11-18T00:01:00.000Z',
        out,
      ),
    ).toBe(1);
    expect(await readFile(file, 'utf8')).toBe(bytes);
  });
});

it('runs the native no-key CLI without a build step or secrets', async () => {
  expect(
    await runAsScript('../../scripts/chain-refresh.mjs', [], {
      BLOCKFROST_MAINNET_PROJECT_ID: '',
      BLOCKFROST_PREVIEW_PROJECT_ID: '',
    }),
  ).toBe(0);
});
