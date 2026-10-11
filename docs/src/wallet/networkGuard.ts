import type {CardanoNetwork} from '../../config/profiles';

/**
 * ENV-2 — wallet network mismatch is a hard block (stub; B25 wires it into the wallet flow).
 *
 * CIP-30 `getNetworkId()` returns 1 for mainnet and 0 for every testnet, so a wallet on preprod
 * passes a preview build here. That is as far as CIP-30 can see; it still stops the case that
 * costs real ADA, a mainnet wallet on the preview site.
 */

/** CIP-30 network id each build network expects. */
export const CIP30_NETWORK_ID: Readonly<Record<CardanoNetwork, number>> = Object.freeze({
  mainnet: 1,
  preview: 0,
});

/** The part of the CIP-30 wallet API the guard needs. */
export interface Cip30NetworkApi {
  getNetworkId(): Promise<number>;
}

function describeNetworkId(id: unknown): string {
  if (typeof id !== 'number' || !Number.isInteger(id)) {
    return 'a network it could not identify';
  }
  if (id === CIP30_NETWORK_ID.mainnet) {
    return 'Cardano mainnet';
  }
  if (id === CIP30_NETWORK_ID.preview) {
    return 'a Cardano testnet';
  }
  return `an unknown network (id ${id})`;
}

/** The named error state the wallet flow shows when the wallet is on the wrong network. */
export class WalletNetworkMismatchError extends Error {
  readonly code = 'WALLET_NETWORK_MISMATCH';

  constructor(
    readonly expected: CardanoNetwork,
    /** What the wallet returned. CIP-30 promises a number; a wallet that breaks that is rejected. */
    readonly actualId: unknown,
  ) {
    super(
      `Your wallet is connected to ${describeNetworkId(actualId)}, but this site uses the ` +
        `Cardano ${expected} network. Switch your wallet to ${expected} and connect again. ` +
        'Nothing was signed or submitted.',
    );
    this.name = 'WalletNetworkMismatchError';
  }
}

/**
 * Resolves when the wallet is on the build's network and rejects with
 * {@link WalletNetworkMismatchError} when it is not. Call it before constructing any transaction,
 * and again immediately before asking the wallet to sign: CIP-30 has no network-change event, so a
 * wallet can switch networks after connecting.
 * A wallet that cannot report its network rejects too, with the wallet's own error.
 */
export async function assertWalletNetwork(
  api: Cip30NetworkApi,
  network: CardanoNetwork,
): Promise<void> {
  const actualId: unknown = await api.getNetworkId();
  if (actualId !== CIP30_NETWORK_ID[network]) {
    throw new WalletNetworkMismatchError(network, actualId);
  }
}
