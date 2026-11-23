import type {CardanoNetwork} from '../../config/profiles';
import type {Cip30NetworkApi} from './networkGuard';

/** The CIP-30 subset used by the survey. Never hand this object to the composer. */
export interface Cip30SurveyApi extends Cip30NetworkApi {
  getUtxos(): Promise<string[] | null>;
  getChangeAddress(): Promise<string>;
  getRewardAddresses(): Promise<string[]>;
  signTx(transaction: string, partialSign?: boolean): Promise<string>;
  submitTx(transaction: string): Promise<string>;
}

/** Display text only; no wallet-supplied HTML or resource URLs. */
export interface WalletInfo {
  readonly id: string;
  readonly name: string;
}

/** Snapshot read after the network guard, not the wallet's privileged API. CIP-30 hex strings. */
export interface WalletInputs {
  readonly network: CardanoNetwork;
  readonly utxos: readonly string[];
  readonly changeAddress: string;
  readonly rewardAddresses: readonly string[];
}

export interface SurveyTransaction {
  /** B24/B32 owns CBOR, fees, metadata and transaction-network validation. No signing here. */
  build(inputs: WalletInputs): Promise<string>;
  /** CIP-30 signTx returns a witness set, NOT a signed transaction. Preserve the body. */
  assemble(unsignedTransaction: string, witnessSet: string): Promise<string>;
}

export interface WalletSession {
  readonly wallet: WalletInfo;
  readonly network: CardanoNetwork;
  /** Local invalidation only: CIP-30 has no revoke/disconnect method. */
  disconnect(): void;
  /** One explicit user action; guards every side-effect boundary. Returns the transaction hash. */
  signAndSubmit(transaction: SurveyTransaction): Promise<string>;
}
