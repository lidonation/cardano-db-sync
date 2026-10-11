import {describe, expect, it} from 'vitest';

import {
  CIP30_NETWORK_ID,
  WalletNetworkMismatchError,
  assertWalletNetwork,
} from '../../src/wallet/networkGuard';

const wallet = (id: number) => ({getNetworkId: async () => id});

describe('ENV-2: wallet network guard', () => {
  it('uses the CIP-30 network ids', () => {
    expect(CIP30_NETWORK_ID).toEqual({mainnet: 1, preview: 0});
  });

  it.each([
    ['preview', 0],
    ['mainnet', 1],
  ] as const)('lets a %s wallet through on a %s build', async (network, id) => {
    await expect(assertWalletNetwork(wallet(id), network)).resolves.toBeUndefined();
  });

  it('rejects a mainnet wallet on the preview build with a named, clear error', async () => {
    const error = await assertWalletNetwork(wallet(1), 'preview').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(WalletNetworkMismatchError);
    expect(error).toMatchObject({
      name: 'WalletNetworkMismatchError',
      code: 'WALLET_NETWORK_MISMATCH',
      expected: 'preview',
      actualId: 1,
    });
    expect((error as Error).message).toBe(
      'Your wallet is connected to Cardano mainnet, but this site uses the Cardano preview ' +
        'network. Switch your wallet to preview and connect again. Nothing was signed or submitted.',
    );
  });

  it('rejects a testnet wallet on the mainnet build', async () => {
    await expect(assertWalletNetwork(wallet(0), 'mainnet')).rejects.toThrow(
      /connected to a Cardano testnet, but this site uses the Cardano mainnet network/,
    );
  });

  it('rejects a network id CIP-30 does not define', async () => {
    await expect(assertWalletNetwork(wallet(7), 'preview')).rejects.toThrow(
      /an unknown network \(id 7\)/,
    );
  });

  it('fails closed when the wallet cannot report its network', async () => {
    const broken = {getNetworkId: () => Promise.reject(new Error('wallet locked'))};
    await expect(assertWalletNetwork(broken, 'preview')).rejects.toThrow('wallet locked');
  });

  it.each([['1'], [undefined], [1.5], [Number.NaN]])(
    'rejects a wallet that returns %s instead of a CIP-30 network id, without naming a network',
    async (bad) => {
      const liar = {getNetworkId: async () => bad as unknown as number};
      const error = await assertWalletNetwork(liar, 'preview').catch((e: unknown) => e);
      expect(error).toBeInstanceOf(WalletNetworkMismatchError);
      expect((error as Error).message).toMatch(/connected to a network it could not identify/);
    },
  );
});
