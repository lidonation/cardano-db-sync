/**
 * B44-f — pure resolution helpers over the locked render contracts (`./types`).
 * No chain reads, no tallying, no wallet: subsumption resolution (SUR-26/27/28),
 * the pre-tally predicate, and the SUR-7 moderation filter.
 */
import type {
  Aggregate,
  FreeTextItem,
  ResolvedAggregate,
  SurveyManifest,
} from './types';

/** Every reason the manifest cannot be trusted, as readable lines. Empty means sound. */
export function validateManifest(manifest: SurveyManifest): string[] {
  void manifest;
  throw new Error('not implemented');
}

/** True when no tally has run yet: the page renders its named pre-tally empty state. */
export function isPreTally(aggregate: Aggregate): boolean {
  void aggregate;
  throw new Error('not implemented');
}

/** SUR-7 — the free-text items that passed review. Unreviewed items never reach the page. */
export function moderatedFreeText(aggregate: Aggregate): FreeTextItem[] {
  void aggregate;
  throw new Error('not implemented');
}

/**
 * Apply the manifest's subsumption edges to an aggregate (SUR-28): `replaces` folds the
 * older option's count into its absorber as a labelled editorial merge; `supersedes`
 * closes the older question for separate reporting. Pure: inputs are never mutated.
 */
export function resolveAggregate(
  manifest: SurveyManifest,
  aggregate: Aggregate,
): ResolvedAggregate {
  void manifest;
  void aggregate;
  throw new Error('not implemented');
}
