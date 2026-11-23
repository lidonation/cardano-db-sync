import type {CardanoNetwork} from '../../config/profiles';
import {assertWalletNetwork} from './networkGuard';
import type {Cip30SurveyApi, SurveyTransaction, WalletInfo, WalletSession} from './types';

export class WalletError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'WalletError';
  }
}

// CIP-30 specifies `1`; deployed bridges also use semver strings. In particular the
// Cardano JS SDK Cip30Wallet reports `0.1.0`. Methods are still validated after enable.
interface Provider {
  name: string;
  apiVersion: string;
  enable(): Promise<unknown>;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Read only on an explicit discovery/connect action, never during SSR/module evaluation. */
function injected(): unknown {
  return typeof window === 'undefined'
    ? undefined
    : (window as Window & {cardano?: unknown}).cardano;
}

function providerAt(registry: unknown, id: string): Provider | undefined {
  if (!record(registry) || !Object.hasOwn(registry, id)) return;
  // An unavailable extension getter must not hide other installed wallets.
  try {
    const provider = registry[id];
    if (
      record(provider) &&
      typeof provider.apiVersion === 'string' &&
      ['1', '1.0.0', '0.1.0'].includes(provider.apiVersion) &&
      typeof provider.name === 'string' &&
      provider.name.trim() !== '' &&
      typeof provider.enable === 'function'
    ) {
      return provider as unknown as Provider;
    }
  } catch {
    return;
  }
}

/** Candidates, not a promise of tested wallet support. Does not request consent or load icons. */
export function discoverWallets(registry: unknown = injected()): readonly WalletInfo[] {
  if (!record(registry)) return [];
  return Object.keys(registry).flatMap((id) => {
    const provider = providerAt(registry, id);
    return provider ? [Object.freeze({id, name: provider.name})] : [];
  });
}

const API_METHODS = [
  'getNetworkId',
  'getUtxos',
  'getChangeAddress',
  'getRewardAddresses',
  'signTx',
  'submitTx',
] as const;

function surveyApi(value: unknown): value is Cip30SurveyApi {
  return record(value) && API_METHODS.every((method) => typeof value[method] === 'function');
}

/** CIP-30 is an external boundary: hex is necessary, CBOR semantics belong to the builder. */
function hex(value: unknown): value is string {
  return typeof value === 'string' && /^(?:[0-9a-fA-F]{2})+$/.test(value);
}

function hexList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(hex);
}

/** Normalize untrusted wallet errors; never render their info/HTML or log private wallet data. */
async function call<T>(code: string, message: string, action: () => Promise<T>): Promise<T> {
  try {
    return await action();
  } catch {
    throw new WalletError(code, message);
  }
}

/**
 * Enable only the wallet the person selected. The caller passes customFields.profile.network;
 * neither browser storage nor a UI override can change the session's expected network.
 * No polling, automatic reconnect, transaction retry, wallet persistence or raw signing API.
 */
export async function connectWallet(
  id: string,
  network: CardanoNetwork,
  registry: unknown = injected(),
): Promise<WalletSession> {
  if (network !== 'preview' && network !== 'mainnet') {
    throw new WalletError('WALLET_CONFIGURATION', 'This site has no valid Cardano network.');
  }
  const provider = providerAt(registry, id);
  if (!provider) {
    throw new WalletError(
      'WALLET_UNAVAILABLE',
      'The selected CIP-30 wallet is unavailable. Unlock it, refresh the wallet list and connect again.',
    );
  }
  const candidate = await call(
    'WALLET_CONNECTION_FAILED',
    'Wallet access was not granted. Unlock your wallet and approve access. Connect again when ready.',
    () => provider.enable(),
  );
  if (!surveyApi(candidate)) {
    throw new WalletError(
      'WALLET_UNSUPPORTED',
      'This wallet does not provide the required CIP-30 API. Choose another wallet.',
    );
  }
  const api = candidate;
  let active = true;
  let busy = false;

  function assertActive() {
    if (!active) {
      throw new WalletError(
        'WALLET_DISCONNECTED',
        'This wallet session has ended. Connect again before continuing.',
      );
    }
  }

  async function guard() {
    assertActive();
    // Only normalize query failures; preserve the named network-mismatch error from the guard.
    await assertWalletNetwork(
      {
        getNetworkId: () =>
          call(
            'WALLET_NETWORK_UNAVAILABLE',
            'Your wallet could not report its network. Unlock it and connect again.',
            () => api.getNetworkId(),
          ),
      },
      network,
    );
    assertActive();
  }

  await guard();
  return Object.freeze({
    wallet: Object.freeze({id, name: provider.name}),
    network,
    disconnect() {
      active = false;
    },
    async signAndSubmit(transaction: SurveyTransaction): Promise<string> {
      assertActive();
      if (busy)
        throw new WalletError(
          'WALLET_BUSY',
          'A wallet transaction is already in progress. Wait for it to finish.',
        );
      busy = true;
      try {
        await guard();
        assertActive();
        const [utxos, changeAddress, rewardAddresses] = await call(
          'WALLET_READ_FAILED',
          'Wallet data could not be read. Unlock your wallet and connect again.',
          () => Promise.all([api.getUtxos(), api.getChangeAddress(), api.getRewardAddresses()]),
        );
        await guard();
        assertActive();
        if (utxos === null || (Array.isArray(utxos) && utxos.length === 0)) {
          throw new WalletError(
            'WALLET_NO_UTXOS',
            'Your wallet has no spendable outputs. Fund it on this site’s network and connect again.',
          );
        }
        if (!hexList(utxos) || !hex(changeAddress) || !hexList(rewardAddresses)) {
          throw new WalletError(
            'WALLET_INVALID_DATA',
            'Your wallet returned invalid transaction inputs. Connect again or choose another wallet.',
          );
        }
        const unsigned = await call(
          'WALLET_BUILD_FAILED',
          'The survey transaction could not be constructed. Connect again and review your answers.',
          () =>
            transaction.build(
              Object.freeze({
                network,
                utxos: Object.freeze([...utxos]),
                changeAddress,
                rewardAddresses: Object.freeze([...rewardAddresses]),
              }),
            ),
        );
        if (!hex(unsigned))
          throw new WalletError(
            'WALLET_INVALID_TRANSACTION',
            'The survey builder returned an invalid transaction. Nothing will be signed.',
          );
        await guard();
        assertActive();
        const witnesses = await call(
          'WALLET_SIGNING_FAILED',
          'Your wallet did not sign the survey transaction. Connect again if you want to retry.',
          () => api.signTx(unsigned, false),
        );
        if (!hex(witnesses))
          throw new WalletError(
            'WALLET_INVALID_WITNESSES',
            'Your wallet returned invalid witnesses. The transaction will not be submitted.',
          );
        await guard();
        assertActive();
        const signed = await call(
          'WALLET_ASSEMBLY_FAILED',
          'The signed transaction could not be assembled. Nothing was submitted. Connect again to retry.',
          () => transaction.assemble(unsigned, witnesses),
        );
        if (!hex(signed))
          throw new WalletError(
            'WALLET_INVALID_TRANSACTION',
            'The survey builder returned an invalid signed transaction. Nothing was submitted.',
          );
        await guard();
        assertActive();
        const hash = await call(
          'WALLET_SUBMISSION_FAILED',
          'Your wallet could not confirm submission. Check its transaction history before trying again.',
          () => api.submitTx(signed),
        );
        // Do not lose a confirmed hash if disconnect happened during submit: it cannot unsend it.
        if (!hex(hash) || hash.length !== 64)
          throw new WalletError(
            'WALLET_SUBMISSION_FAILED',
            'Your wallet returned an invalid transaction hash. Check its transaction history before trying again.',
          );
        return hash;
      } catch (error) {
        active = false;
        throw error;
      } finally {
        busy = false;
      }
    },
  });
}
