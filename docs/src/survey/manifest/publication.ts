/** Build boundary for the existing single-survey dashboard artifact. Multi-survey editorial
 * counts belong to B26, not this registry: never guess overlap from marginal totals. */
import {END_EPOCH} from '../../survey-results/types';
import type {Aggregate, SurveyManifest} from '../../survey-results/types';
import type {Network, SurveyRegistry} from './types';

export function publicationManifest(
  registry: SurveyRegistry,
  aggregate: Aggregate,
  network: Network,
): SurveyManifest {
  const survey = registry.surveys.find(
    (s) => s.network === network && s.surveyRef === aggregate.surveyRef,
  );
  const hasData =
    aggregate.questions.length > 0 ||
    aggregate.freeText.length > 0 ||
    (aggregate.replacements?.length ?? 0) > 0;
  if (!survey) {
    // Legacy pre-tally sentinel only, not an on-chain survey_ref or a registered definition.
    if (
      aggregate.surveyRef !== 'core-1' ||
      hasData ||
      aggregate.endEpoch !== END_EPOCH ||
      registry.current[network] !== null
    ) {
      throw new Error('Survey aggregate requires a canonical definition on the build network');
    }
  } else {
    if (
      survey.endEpoch !== aggregate.endEpoch ||
      (hasData && survey.cancelledEpoch !== undefined)
    ) {
      throw new Error('Survey aggregate epoch mismatch or cancelled definition');
    }
    for (const question of aggregate.questions) {
      const registered = survey.questions[question.question];
      if (
        !registered ||
        question.options.some((option) => option.option >= (registered.optionCount ?? 0))
      ) {
        throw new Error('Survey aggregate question/option is not registered');
      }
    }
    if (
      hasData &&
      registry.surveys.some(
        (s) =>
          s.network === network &&
          s.subsumes.some(
            (edge) => s.surveyRef === survey.surveyRef || edge.older.surveyRef === survey.surveyRef,
          ),
      )
    ) {
      throw new Error(
        'Cross-survey results require a registry-resolved B26 artifact; marginal counts cannot be merged',
      );
    }
  }
  return {surveyRef: aggregate.surveyRef, endEpoch: aggregate.endEpoch, subsumptions: []};
}
