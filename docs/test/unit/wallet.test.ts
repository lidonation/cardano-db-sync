import {describe, expect, it, vi} from 'vitest';

import {connectWallet, discoverWallets, WalletError} from '../../src/wallet/client';
import {WalletNetworkMismatchError} from '../../src/wallet/networkGuard';
import type {Cip30SurveyApi, SurveyTransaction} from '../../src/wallet/types';

function fixture(id = 0) {
  const api = {
    getNetworkId: vi.fn(async () => id),
    getUtxos: vi.fn(async () => ['a0']),
    getChangeAddress: vi.fn(async () => '60aa'),
    getRewardAddresses: vi.fn(async () => ['e0aa']),
    signTx: vi.fn(async () => 'a100'),
    submitTx: vi.fn(async () => 'ab'.repeat(32)),
  } satisfies Cip30SurveyApi;
  const provider = {name: 'Example wallet', apiVersion: '1', enable: vi.fn(async () => api)};
  const registry = {example: provider};
  const transaction = {
    build: vi.fn(async () => '84a0'),
    assemble: vi.fn(async () => '84a1'),
  } satisfies SurveyTransaction;
  return {api, provider, registry, transaction};
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return {promise, resolve};
}

describe('CIP-30 discovery and connection (R1)', () => {
  it('is SSR safe and does not prompt or return resource URLs', () => {
    const f = fixture();
    expect(discoverWallets()).toEqual([]);
    expect(
      discoverWallets({
        ...f.registry,
        junk: {},
        enable: () => {},
        v2: {...f.provider, apiVersion: '2'},
      }),
    ).toEqual([{id: 'example', name: 'Example wallet'}]);
    expect(f.provider.enable).not.toHaveBeenCalled();
    expect(discoverWallets(null)).toEqual([]);
  });

  it('uses browser injection at call time, not at import', async () => {
    const f = fixture();
    vi.stubGlobal('window', {cardano: f.registry});
    try {
      expect(discoverWallets()).toEqual([{id: 'example', name: 'Example wallet'}]);
      expect((await connectWallet('example', 'preview')).wallet.id).toBe('example');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('only enables a selected own provider and rejects missing or unsupported wallets', async () => {
    const f = fixture();
    for (const id of ['missing', 'toString', '__proto__']) {
      await expect(connectWallet(id, 'preview', f.registry)).rejects.toMatchObject({
        code: 'WALLET_UNAVAILABLE',
      });
    }
    await expect(
      connectWallet('example', 'preview', {example: {...f.provider, apiVersion: '2'}}),
    ).rejects.toMatchObject({code: 'WALLET_UNAVAILABLE'});
    expect(f.provider.enable).not.toHaveBeenCalled();
  });

  it('handles malformed and inaccessible providers independently', () => {
    const f = fixture();
    const registry = {...f.registry, empty: {...f.provider, name: ''}};
    Object.defineProperty(registry, 'broken', {
      enumerable: true,
      get: () => {
        throw new Error('extension unavailable');
      },
    });
    expect(discoverWallets(registry)).toEqual([{id: 'example', name: 'Example wallet'}]);
  });

  it('preserves method receivers for injection bridges', async () => {
    const f = fixture();
    f.provider.enable.mockImplementation(async function (this: typeof f.provider) {
      expect(this).toBe(f.provider);
      return f.api;
    });
    f.api.getNetworkId.mockImplementation(async function (this: typeof f.api) {
      expect(this).toBe(f.api);
      return 0;
    });
    const session = await connectWallet('example', 'preview', f.registry);
    expect(session).not.toHaveProperty('api');
    expect(session).not.toHaveProperty('signTx');
  });

  it('fails closed on bad site configuration, denied enable and incomplete API', async () => {
    const f = fixture();
    await expect(
      connectWallet('example', 'invalid' as 'preview', f.registry),
    ).rejects.toMatchObject({code: 'WALLET_CONFIGURATION'});
    expect(f.provider.enable).not.toHaveBeenCalled();
    f.provider.enable.mockRejectedValueOnce({code: -3, info: '<secret extension data>'});
    await expect(connectWallet('example', 'preview', f.registry)).rejects.toMatchObject({
      code: 'WALLET_CONNECTION_FAILED',
      message: expect.stringContaining('Connect again'),
    });
    f.provider.enable.mockResolvedValueOnce({getNetworkId: f.api.getNetworkId} as typeof f.api);
    await expect(connectWallet('example', 'preview', f.registry)).rejects.toMatchObject({
      code: 'WALLET_UNSUPPORTED',
    });
  });
});

describe('ENV-2 guarded transaction pipeline (R2, R4)', () => {
  it.each([
    ['preview', 0],
    ['mainnet', 1],
  ] as const)(
    'runs a matching %s flow, assembling witnesses before submitting',
    async (network, id) => {
      const f = fixture(id);
      const session = await connectWallet('example', network, f.registry);
      await expect(session.signAndSubmit(f.transaction)).resolves.toBe('ab'.repeat(32));
      expect(f.transaction.build).toHaveBeenCalledWith({
        network,
        utxos: ['a0'],
        changeAddress: '60aa',
        rewardAddresses: ['e0aa'],
      });
      expect(f.api.signTx).toHaveBeenCalledWith('84a0', false);
      expect(f.transaction.assemble).toHaveBeenCalledWith('84a0', 'a100');
      expect(f.api.submitTx).toHaveBeenCalledWith('84a1');
      expect(f.api.getNetworkId).toHaveBeenCalledTimes(6);
    },
  );

  it.each([
    ['preview', 1],
    ['mainnet', 0],
  ] as const)('blocks wrong-network connection to %s', async (network, id) => {
    const f = fixture(id);
    await expect(connectWallet('example', network, f.registry)).rejects.toBeInstanceOf(
      WalletNetworkMismatchError,
    );
    expect(f.api.getUtxos).not.toHaveBeenCalled();
    expect(f.api.signTx).not.toHaveBeenCalled();
  });

  it.each([
    'before reads',
    'during reads',
    'during construction',
    'during signing',
    'during assembly',
  ] as const)('blocks a network switch %s without downstream effects', async (boundary) => {
    const f = fixture();
    const session = await connectWallet('example', 'preview', f.registry);
    const switchNetwork = () => f.api.getNetworkId.mockResolvedValue(1);
    if (boundary === 'before reads') switchNetwork();
    if (boundary === 'during reads')
      f.api.getChangeAddress.mockImplementation(async () => {
        switchNetwork();
        return '60aa';
      });
    if (boundary === 'during construction')
      f.transaction.build.mockImplementation(async () => {
        switchNetwork();
        return '84a0';
      });
    if (boundary === 'during signing')
      f.api.signTx.mockImplementation(async () => {
        switchNetwork();
        return 'a100';
      });
    if (boundary === 'during assembly')
      f.transaction.assemble.mockImplementation(async () => {
        switchNetwork();
        return '84a1';
      });
    await expect(session.signAndSubmit(f.transaction)).rejects.toBeInstanceOf(
      WalletNetworkMismatchError,
    );
    expect(f.api.submitTx).not.toHaveBeenCalled();
    if (['before reads', 'during reads', 'during construction'].includes(boundary))
      expect(f.api.signTx).not.toHaveBeenCalled();
    if (['before reads', 'during reads'].includes(boundary))
      expect(f.transaction.build).not.toHaveBeenCalled();
    await expect(session.signAndSubmit(f.transaction)).rejects.toMatchObject({
      code: 'WALLET_DISCONNECTED',
    });
  });

  it('fails closed if a network query fails after connecting', async () => {
    const f = fixture();
    const session = await connectWallet('example', 'preview', f.registry);
    f.api.getNetworkId.mockRejectedValue({info: 'private wallet details'});
    await expect(session.signAndSubmit(f.transaction)).rejects.toMatchObject({
      code: 'WALLET_NETWORK_UNAVAILABLE',
    });
    expect(f.transaction.build).not.toHaveBeenCalled();
    expect(f.api.signTx).not.toHaveBeenCalled();
  });
});

describe('session lifecycle and failures (R3)', () => {
  it.each(['network', 'reads', 'build', 'sign', 'assemble'] as const)(
    'disconnect during %s stops the next action',
    async (boundary) => {
      const f = fixture();
      const session = await connectWallet('example', 'preview', f.registry);
      const stop =
        <T>(value: T) =>
        async () => {
          session.disconnect();
          return value;
        };
      if (boundary === 'network') f.api.getNetworkId.mockImplementation(stop(0));
      if (boundary === 'reads') f.api.getUtxos.mockImplementation(stop(['a0']));
      if (boundary === 'build') f.transaction.build.mockImplementation(stop('84a0'));
      if (boundary === 'sign') f.api.signTx.mockImplementation(stop('a100'));
      if (boundary === 'assemble') f.transaction.assemble.mockImplementation(stop('84a1'));
      await expect(session.signAndSubmit(f.transaction)).rejects.toMatchObject({
        code: 'WALLET_DISCONNECTED',
      });
      expect(f.api.submitTx).not.toHaveBeenCalled();
    },
  );

  it('rejects overlap without invalidating the running transaction', async () => {
    const f = fixture();
    const session = await connectWallet('example', 'preview', f.registry);
    const pending = deferred<string>();
    f.transaction.build.mockReturnValueOnce(pending.promise);
    const first = session.signAndSubmit(f.transaction);
    await expect(session.signAndSubmit(f.transaction)).rejects.toMatchObject({code: 'WALLET_BUSY'});
    pending.resolve('84a0');
    await expect(first).resolves.toBe('ab'.repeat(32));
    expect(f.api.submitTx).toHaveBeenCalledTimes(1);
  });

  it.each(['read', 'build', 'sign', 'assemble', 'submit'] as const)(
    'does not retry a failed %s operation or leak wallet errors',
    async (stage) => {
      const f = fixture();
      const session = await connectWallet('example', 'preview', f.registry);
      const fail = async () => {
        throw {code: -3, info: 'private wallet data'};
      };
      if (stage === 'read') f.api.getUtxos.mockImplementation(fail);
      if (stage === 'build') f.transaction.build.mockImplementation(fail);
      if (stage === 'sign') f.api.signTx.mockImplementation(fail);
      if (stage === 'assemble') f.transaction.assemble.mockImplementation(fail);
      if (stage === 'submit') f.api.submitTx.mockImplementation(fail);
      const error = await session.signAndSubmit(f.transaction).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(WalletError);
      expect((error as Error).message).not.toContain('private');
      if (stage === 'submit') expect((error as Error).message).toContain('transaction history');
      else expect(f.api.submitTx).not.toHaveBeenCalled();
      await expect(session.signAndSubmit(f.transaction)).rejects.toMatchObject({
        code: 'WALLET_DISCONNECTED',
      });
    },
  );

  it.each(['utxos', 'change', 'rewards', 'unsigned', 'witness', 'signed', 'hash'] as const)(
    'rejects malformed %s at the boundary',
    async (stage) => {
      const f = fixture();
      const session = await connectWallet('example', 'preview', f.registry);
      if (stage === 'utxos') f.api.getUtxos.mockResolvedValue(['not hex']);
      if (stage === 'change') f.api.getChangeAddress.mockResolvedValue('');
      if (stage === 'rewards') f.api.getRewardAddresses.mockResolvedValue(['0']);
      if (stage === 'unsigned') f.transaction.build.mockResolvedValue('bad');
      if (stage === 'witness') f.api.signTx.mockResolvedValue('');
      if (stage === 'signed') f.transaction.assemble.mockResolvedValue('xyz');
      if (stage === 'hash') f.api.submitTx.mockResolvedValue('aa');
      await expect(session.signAndSubmit(f.transaction)).rejects.toBeInstanceOf(WalletError);
      if (stage !== 'hash') expect(f.api.submitTx).not.toHaveBeenCalled();
    },
  );

  it('handles a null UTxO set without calling the builder or signer', async () => {
    const f = fixture();
    f.api.getUtxos.mockResolvedValue(null as unknown as string[]);
    const session = await connectWallet('example', 'preview', f.registry);
    await expect(session.signAndSubmit(f.transaction)).rejects.toMatchObject({
      code: 'WALLET_NO_UTXOS',
    });
    expect(f.transaction.build).not.toHaveBeenCalled();
  });

  it('reports a confirmed submission even if disconnected while submit was in flight', async () => {
    const f = fixture();
    const session = await connectWallet('example', 'preview', f.registry);
    f.api.submitTx.mockImplementation(async () => {
      session.disconnect();
      return 'ab'.repeat(32);
    });
    await expect(session.signAndSubmit(f.transaction)).resolves.toBe('ab'.repeat(32));
    await expect(session.signAndSubmit(f.transaction)).rejects.toMatchObject({
      code: 'WALLET_DISCONNECTED',
    });
  });
});
