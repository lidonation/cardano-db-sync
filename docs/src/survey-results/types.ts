/**
 * B44-f — survey results dashboard render contracts (frontend-only).
 *
 * These types describe the *render half* of the survey pipeline: the dashboard reads the
 * committed `aggregate.json` (produced by B26's tally job) through the committed
 * `survey_ref` manifest (maintained by B27) and renders them. Nothing here takes a survey,
 * builds a CIP-179 payload, tallies a transaction, or touches a wallet — that backend work
 * belongs to B24/B25/B26/B27/B32.
 *
 * Criteria: SUR-3 (manifest shape), SUR-7 (moderation gate), SUR-18 (derived history),
 * SUR-19 (tally basis), SUR-26/27/28 (subsumption), SUR-30 (interim-forever).
 */

/** The only `end_epoch` this site accepts: the core standing survey runs to epoch 2000. */
export const END_EPOCH = 2000;

/** SUR-19 — interim tallies use response-time validation only. */
export const TALLY_BASIS = 'response-time-only' as const;
export type TallyBasis = typeof TALLY_BASIS;

/** SUR-28 — how a newer option relates to the older one it absorbs. */
export type SubsumptionKind = 'replaces' | 'supersedes';

/** An on-chain question or option index (SUR-5: indices are the interlingua). */
export interface IndexedRef {
  readonly question: number;
  readonly option: number;
}

/**
 * SUR-26 — subsumption is declared forward only (new → old) at question granularity.
 * `newer` absorbs `older`; `kind` decides whether counts merge (`replaces`) or the older
 * question is closed and reported separately (`supersedes`, SUR-28).
 */
export interface SubsumptionEdge {
  readonly newer: IndexedRef;
  readonly older: IndexedRef;
  readonly kind: SubsumptionKind;
}

/** SUR-3 — the reviewed repo manifest, authoritative for the build. */
export interface SurveyManifest {
  readonly surveyRef: string;
  readonly endEpoch: number;
  readonly subsumptions: readonly SubsumptionEdge[];
}

export interface OptionTally {
  readonly option: number;
  readonly label: string;
  readonly count: number;
}

export interface HistoryPoint {
  readonly epoch: number;
  /** Per-option counts in option-index order. */
  readonly counts: readonly number[];
}

export interface QuestionTally {
  readonly question: number;
  readonly label: string;
  readonly options: readonly OptionTally[];
  /**
   * SUR-18 — derived, not structural: a historical view computed from response epochs.
   * Rendered only with its derived labelling, never as a CIP-179 tally.
   */
  readonly history?: readonly HistoryPoint[];
}

export interface FreeTextItem {
  readonly id: string;
  readonly text: string;
  /** SUR-7 — only items with `moderated: true` render; the rest never reach the page. */
  readonly moderated: boolean;
}

/**
 * B26's committed artifact, render half. SUR-30 — every published figure is an interim
 * tally permanently: `interim` is always true, and the page states it.
 */
export interface Aggregate {
  readonly surveyRef: string;
  readonly tallyBasis: TallyBasis;
  readonly interim: true;
  readonly endEpoch: number;
  readonly questions: readonly QuestionTally[];
  readonly freeText: readonly FreeTextItem[];
  readonly generatedAt: string;
}

/** An option folded into its absorber by a `replaces` edge (SUR-28), kept for labelling. */
export interface AbsorbedOption {
  readonly question: number;
  readonly option: number;
  readonly label: string;
  readonly count: number;
}

export interface ResolvedOption {
  readonly option: number;
  readonly label: string;
  readonly count: number;
  /** Present when `replaces` edges folded older options into this one: our editorial view. */
  readonly absorbedFrom?: readonly AbsorbedOption[];
}

export interface ResolvedQuestion {
  readonly question: number;
  readonly label: string;
  readonly options: readonly ResolvedOption[];
  readonly history?: readonly HistoryPoint[];
  /**
   * Labels of the options each history count column belongs to, in counts order:
   * history is tallied in original option order, which subsumption may have folded.
   * Present exactly when `history` is present.
   */
  readonly historyOptions?: readonly string[];
}

/**
 * A `supersedes` edge closes the older question: it is never merged, and the dashboard
 * reports it separately (SUR-28).
 */
export interface ClosedQuestion {
  readonly question: number;
  readonly label: string;
  readonly options: readonly OptionTally[];
  readonly supersededBy: IndexedRef;
}

export interface ResolvedAggregate {
  readonly surveyRef: string;
  readonly tallyBasis: TallyBasis;
  readonly interim: true;
  readonly endEpoch: number;
  readonly questions: readonly ResolvedQuestion[];
  readonly closed: readonly ClosedQuestion[];
  /** True when at least one `replaces` merge folded counts: the merge is editorial (SUR-28). */
  readonly editorialMerge: boolean;
  readonly freeText: readonly FreeTextItem[];
  readonly generatedAt: string;
}

/** Props for the dashboard view: resolved data plus a translate function (page wires hooks). */
export interface DashboardProps {
  readonly resolved: ResolvedAggregate;
  readonly translate: (message: {readonly id: string; readonly message: string}) => string;
}
