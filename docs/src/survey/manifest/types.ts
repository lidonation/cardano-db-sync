/** B27: reviewed lifecycle authority, not chain proof or a CIP-179 tally. */
export type Network = 'preview' | 'mainnet';
export type SubsumptionKind = 'replaces' | 'supersedes';
export interface QuestionRef {
  readonly surveyRef: string;
  readonly question: number;
}
export interface Subsumption {
  readonly question: number;
  readonly older: QuestionRef;
  readonly kind: SubsumptionKind;
  /** Equivalent option meanings only. Required for replaces between option questions. */
  readonly optionMap?: readonly {readonly older: number; readonly newer: number}[];
}
export interface SurveyRecord {
  /** Lowercase transaction hash + # + local definition index (uint16). */
  readonly surveyRef: string;
  readonly network: Network;
  readonly kind: 'core' | 'supplementary';
  readonly owner: {readonly type: 'key' | 'script'; readonly hash: string};
  readonly definedEpoch: number;
  readonly endEpoch: number;
  /** Reviewed cancellation fact, not an instruction to cancel on chain. */
  readonly cancelledEpoch?: number;
  /** Array positions are immutable question indices. No labels or translated identity. */
  readonly questions: readonly {readonly optionCount?: number}[];
  /** A new concurrent definition, never an amendment of this earlier definition. */
  readonly evolvesFrom?: string;
  readonly subsumes: readonly Subsumption[];
}
export interface SurveyRegistry {
  readonly schemaVersion: 1;
  readonly current: Readonly<Record<Network, string | null>>;
  /** Append in publication order; old records remain, including cancelled/expired ones. */
  readonly surveys: readonly SurveyRecord[];
}
export interface Successor extends Subsumption {
  readonly newer: QuestionRef;
}
