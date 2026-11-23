import type {Aggregate, QuestionTally} from '../../src/survey-results/types';

export type Network = 'preview' | 'mainnet';
/** Trusted chain-provider evidence, not claims supplied by respondents. */
export interface Transaction {
  id: string;
  slot: number;
  index: number;
  epoch: number;
  metadata: Uint8Array;
  requiredSigners: string[];
  paymentKeys: string[];
  scripts: Record<string, Uint8Array>;
  invalidBefore: number | null;
  invalidHereafter: number | null;
}
export interface ChainInput {
  network: Network;
  epoch: number;
  slot: number;
  block: string;
  generatedAt: string;
  transactions: Transaction[];
  /** Exact fetched bytes keyed by anchor hash; labels never affect validation. */
  presentations: Record<string, Uint8Array>;
}
export interface TallyConfig {
  network: Network;
  /** Reviewed canonical txid#index references. Empty until B27/preview pilot. */
  surveys: {surveyRef: string; endEpoch: number}[];
  /** IDs bind network, txid, response index, question index AND exact text digest. */
  approvedText: string[];
}
export interface AuditRow {
  transaction: string;
  responseIndex: number;
  surveyRef: string | null;
  role: number | null;
  credential: string | null;
  epoch: number;
  status: 'counted' | 'excluded';
  reason: string;
}
export interface MethodTally extends QuestionTally {
  method: number;
  abstain: number;
  /** Numeric value frequencies, or rating value frequencies by option. */
  distributions?: {option?: number; value: number; count: number}[];
  /** Ranking pairwise preference counts: ranked beats unranked; absent/absent ties. */
  pairwise?: number[][];
  /** Points totals, or rating sums, by option. Counts remain respondent counts. */
  totals?: string[];
}
export interface SurveyTally extends Omit<Aggregate, 'interim' | 'tallyBasis'> {
  interim: boolean;
  tallyBasis: 'response-time-only' | 'end-epoch';
  network: Network;
  state: 'interim' | 'final' | 'cancelled';
  /** Keyholders have no mutable registration/expiry; see README. */
  snapshotBasis: 'response-time-only' | 'end-epoch';
  participation: {role: 4; count: number}[];
  questions: MethodTally[];
}
export interface TallyArtifact {
  network: Network;
  generatedAt: string;
  tip: {epoch: number; slot: number; block: string};
  surveys: SurveyTally[];
  audit: AuditRow[];
}
