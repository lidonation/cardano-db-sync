/** CIP-179 v5, public external-content subset. No wallet, ledger identity or signature proof. */
export type Metadatum =
  number | bigint | string | Uint8Array | Metadatum[] | Map<Metadatum, Metadatum>;
export type Credential = [0 | 1, Uint8Array];
export type Anchor = [string | string[], Uint8Array];
export type NumericConstraints = [number, number] | [number, number, number];

/** Index is the position in the definition array; options and levels are also positional. */
export type Question =
  | {tag: 0; anchor: Anchor; required?: boolean}
  | {tag: 1; options: number; required?: boolean}
  | {tag: 2 | 3; options: number; min: number; max: number; required?: boolean}
  | {tag: 4; range: NumericConstraints; required?: boolean}
  | {tag: 5; options: number; budget: number; required?: boolean}
  | {
      tag: 6;
      options: number;
      scale: NumericConstraints | number;
      requireAll: boolean;
      required?: boolean;
    };
export interface Presentation {
  specVersion: 5;
  kind: 'cardano-survey-presentation';
  title: string;
  description: string;
  questions: {prompt: string; options?: string[]; ratingLabels?: string[]}[];
}
export interface DefinitionInput {
  owner: Credential;
  endEpoch: number;
  currentEpoch: number;
  questions: Question[];
  presentation: Presentation;
  /** Exact raw bytes must be published at this URI. Never hash reserialized fetched JSON. */
  presentationUri: string;
}
export type Definition = Map<Metadatum, Metadatum>;
export type Answer = [0 | 1 | 2 | 3 | 4 | 5 | 6, number, Metadatum];
export interface ResponseInput {
  surveyRef: [Uint8Array, number];
  credential: Credential;
  definition: Definition;
  currentEpoch: number;
  answers: Answer[];
  rationale?: Anchor;
}
export type Response = Map<Metadatum, Metadatum>;
/** Full transaction-metadata map, not auxiliary data or a signed transaction. */
export type SurveyMetadata = Map<Metadatum, Metadatum>;
export interface BatchBudget {
  /** Live protocol maxTxSize; the caller must reserve inputs, outputs, witnesses, fees, etc. */
  maxTxBytes: number;
  reservedTxBytes: number;
}
